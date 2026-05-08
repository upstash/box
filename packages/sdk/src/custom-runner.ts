export interface CustomRunnerContext {
  /** Prompt passed to box.agent.run() / box.agent.stream(). */
  prompt: string;
  /** Model label configured for the custom runner. */
  model: string;
  /** Existing session ID when the backend resumes a previous custom run session. */
  sessionId?: string;
  /** Whether the run was requested in streaming mode. */
  stream: boolean;
  /** Raw argv passed to the custom runner process, after the executable/script name. */
  args: string[];
}

export interface CustomRunnerDone {
  output: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  totalCostUsd?: number;
  sessionId?: string;
}

export interface CustomRunnerEmitter {
  text(text: string): void;
  reasoning(text: string): void;
  tool(tool: { toolCallId?: string; name: string; input?: Record<string, unknown> }): void;
  toolResult(result: { toolCallId?: string; output: unknown }): void;
  done(result: CustomRunnerDone): void;
  error(error: Error | string, metadata?: Partial<Omit<CustomRunnerDone, "output">>): void;
  emit(event: string, data: unknown): void;
}

export type CustomRunnerHandler = (
  context: CustomRunnerContext,
  emit: CustomRunnerEmitter,
) => Promise<CustomRunnerDone | string | void> | CustomRunnerDone | string | void;

export interface RunCustomRunnerOptions {
  /** Defaults to process.argv.slice(2). Exposed for tests and embedded runners. */
  argv?: string[];
  /** Defaults to process.stdout.write. Exposed for tests and embedded runners. */
  write?: (chunk: string) => void;
}

function readArg(args: string[], names: string[], fallback = ""): string {
  for (const name of names) {
    const i = args.indexOf(name);
    if (i >= 0 && i + 1 < args.length) return args[i + 1] ?? fallback;
  }
  return fallback;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function createEmitter(write: (chunk: string) => void): CustomRunnerEmitter {
  const emit = (event: string, data: unknown) => {
    write(`event: ${event}\n`);
    write(`data: ${JSON.stringify(data)}\n\n`);
  };

  return {
    text: (text) => emit("text", { text }),
    reasoning: (text) => emit("reasoning", { text }),
    tool: (tool) =>
      emit("tool", {
        toolCallId: tool.toolCallId,
        name: tool.name,
        input: tool.input ?? {},
      }),
    toolResult: (result) => emit("tool_result", result),
    done: (result) =>
      emit("done", {
        output: result.output,
        input_tokens: result.inputTokens ?? 0,
        output_tokens: result.outputTokens ?? 0,
        cached_input_tokens: result.cachedInputTokens ?? 0,
        total_cost_usd: result.totalCostUsd ?? 0,
        session_id: result.sessionId ?? "",
      }),
    error: (error, metadata = {}) =>
      emit("error", {
        error: typeof error === "string" ? error : error.message,
        input_tokens: metadata.inputTokens ?? 0,
        output_tokens: metadata.outputTokens ?? 0,
        cached_input_tokens: metadata.cachedInputTokens ?? 0,
        total_cost_usd: metadata.totalCostUsd ?? 0,
        session_id: metadata.sessionId ?? "",
      }),
    emit,
  };
}

/**
 * Implement a Box custom runner process.
 *
 * The backend runs your command with `-p <prompt> --model <model> --stream` and
 * optionally `--session <sessionId>`. This helper parses those arguments and
 * emits the `box-sse-v1` protocol expected by Box.
 *
 * @example
 * ```ts
 * import { runCustomRunner } from "@upstash/box";
 *
 * await runCustomRunner(async ({ prompt, model }, emit) => {
 *   emit.tool({ name: "custom_runner", input: { model } });
 *   const output = `received: ${prompt}`;
 *   emit.text(output);
 *   return { output, inputTokens: prompt.split(/\s+/).length, outputTokens: output.split(/\s+/).length };
 * });
 * ```
 */
export async function runCustomRunner(
  handler: CustomRunnerHandler,
  options: RunCustomRunnerOptions = {},
): Promise<void> {
  const argv = options.argv ?? process.argv.slice(2);
  const write = options.write ?? ((chunk: string) => process.stdout.write(chunk));
  const emit = createEmitter(write);
  const context: CustomRunnerContext = {
    prompt: readArg(argv, ["-p", "--prompt"]),
    model: readArg(argv, ["--model"], "custom"),
    sessionId: readArg(argv, ["--session"]) || undefined,
    stream: hasFlag(argv, "--stream"),
    args: argv,
  };

  try {
    const result = await handler(context, emit);
    if (typeof result === "string") {
      emit.done({ output: result, sessionId: context.sessionId });
    } else if (result) {
      emit.done(result);
    }
  } catch (error) {
    emit.error(error instanceof Error ? error : String(error), { sessionId: context.sessionId });
    throw error;
  }
}
