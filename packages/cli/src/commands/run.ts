import { readFileSync } from "node:fs";
import { Box } from "@upstash/box";
import { announceBox, resolveBoxId } from "../core/box-ref.js";
import { CliError } from "../core/errors.js";
import { emit, note, requireToken, timeoutMs, type GlobalFlags } from "../core/io.js";

export type RunFlags = GlobalFlags & {
  timeout?: string;
  quiet?: boolean;
};

/**
 * Read the prompt from the arguments or from stdin.
 *
 * A prompt long enough to be worth writing down does not survive shell quoting,
 * so `-` reads it whole.
 * @param parts - the prompt words as the shell split them.
 * @returns the prompt text.
 */
function promptFrom(parts: string[]): string {
  const joined = parts.join(" ").trim();
  if (joined === "-") {
    try {
      return readFileSync(0, "utf8").trim();
    } catch (error) {
      throw new CliError("Could not read the prompt from stdin", { cause: error });
    }
  }
  if (!joined) {
    throw new CliError("Usage: box run <prompt>   (or - to read the prompt from stdin)");
  }
  return joined;
}

/** One line describing a tool call, for the progress log. */
function toolLine(name: string, input: Record<string, unknown>): string {
  const field =
    typeof input.command === "string"
      ? input.command
      : typeof input.file_path === "string"
        ? input.file_path
        : typeof input.pattern === "string"
          ? input.pattern
          : "";
  const trimmed = field.length > 70 ? `${field.slice(0, 67)}...` : field;
  return trimmed ? `· ${name}: ${trimmed}` : `· ${name}`;
}

/**
 * Run the agent on a prompt.
 *
 * The agent's text streams to stdout as it arrives; tool calls go to stderr so
 * a caller can pipe the answer somewhere without the progress log landing in
 * it. `--json` waits for the run to finish and prints the result instead, which
 * is the only form that carries the session id and token usage.
 * @param parts - the prompt, already split by the shell.
 * @param flags - global flags plus --timeout and --quiet.
 */
export async function runCommandAction(parts: string[], flags: RunFlags): Promise<void> {
  const prompt = promptFrom(parts);
  const timeout = timeoutMs(flags.timeout);

  const resolved = resolveBoxId({ flag: flags.box });
  announceBox(resolved);
  const box = await Box.get(resolved.id, { apiKey: requireToken(flags.token) });

  const run = await box.agent.stream({
    prompt,
    ...(timeout === undefined ? {} : { timeout }),
  });

  let output = "";
  let sessionId: string | undefined;
  let usage: Record<string, number> | undefined;
  let finished = false;
  for await (const chunk of run) {
    if (chunk.type === "text-delta") {
      output += chunk.text;
      if (!flags.json) process.stdout.write(chunk.text);
    } else if (chunk.type === "tool-call") {
      if (!flags.json && !flags.quiet) note(toolLine(chunk.toolName, chunk.input));
    } else if (chunk.type === "finish") {
      // Assigned unconditionally: the finish chunk is authoritative, and an
      // empty answer is an answer. Guarding on truthiness kept the partial
      // deltas instead.
      finished = true;
      output = chunk.output;
      sessionId = chunk.sessionId;
      usage = chunk.usage as unknown as Record<string, number>;
    }
  }

  if (!finished) {
    // The iterator can end at EOF without the run ever reporting completion,
    // and a partial answer consumed as a whole one is worse than a failure.
    throw new CliError("The agent's output ended before the run reported finishing");
  }

  if (flags.json) {
    emit({ output, session_id: sessionId ?? null, usage: usage ?? null }, "", flags);
    return;
  }
  process.stdout.write("\n");
}
