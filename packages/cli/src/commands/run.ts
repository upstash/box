import { readFileSync } from "node:fs";
import { Box } from "@upstash/box";
import { announceBox, resolveBoxId } from "../core/box-ref.js";
import { CliError } from "../core/errors.js";
import { emit, note, requireToken, type GlobalFlags } from "../core/io.js";

/** Largest delay Node's timers accept before clamping. */
const MAX_TIMER_MS = 2_147_483_647;

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
  const timeout = flags.timeout === undefined ? undefined : Number(flags.timeout);
  if (timeout !== undefined && (!Number.isFinite(timeout) || timeout <= 0)) {
    throw new CliError("--timeout must be a positive number of seconds");
  }
  // The SDK arms this with setTimeout, and Node clamps a delay beyond its timer
  // range to about a millisecond, so an out-of-range timeout would abort the
  // run almost immediately instead of allowing more time.
  if (timeout !== undefined && timeout * 1000 > MAX_TIMER_MS) {
    throw new CliError(`--timeout must be at most ${Math.floor(MAX_TIMER_MS / 1000)} seconds`);
  }

  const resolved = resolveBoxId({ flag: flags.box });
  announceBox(resolved);
  const box = await Box.get(resolved.id, { apiKey: requireToken(flags.token) });

  const run = await box.agent.stream({
    prompt,
    ...(timeout === undefined ? {} : { timeout: timeout * 1000 }),
  });

  let output = "";
  let sessionId: string | undefined;
  let usage: Record<string, number> | undefined;
  for await (const chunk of run) {
    if (chunk.type === "text-delta") {
      output += chunk.text;
      if (!flags.json) process.stdout.write(chunk.text);
    } else if (chunk.type === "tool-call") {
      if (!flags.json && !flags.quiet) note(toolLine(chunk.toolName, chunk.input));
    } else if (chunk.type === "finish") {
      if (chunk.output) output = chunk.output;
      sessionId = chunk.sessionId;
      usage = chunk.usage as unknown as Record<string, number>;
    }
  }

  if (flags.json) {
    emit({ output, session_id: sessionId ?? null, usage: usage ?? null }, "", flags);
    return;
  }
  process.stdout.write("\n");
}
