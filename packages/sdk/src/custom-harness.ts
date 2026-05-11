export interface CustomHarnessContext {
  /** Prompt passed to box.agent.run() / box.agent.stream(). */
  prompt: string;
  /** Model label configured for the custom harness. */
  model: string;
  /** Existing session ID when the backend resumes a previous custom run session. */
  sessionId?: string;
  /** Whether the run was requested in streaming mode. */
  stream: boolean;
  /** Raw argv passed to the custom harness process, after the executable/script name. */
  args: string[];
}

export interface CustomHarnessDone {
  output: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  totalCostUsd?: number;
  sessionId?: string;
}

export interface CustomHarnessEmitter {
  text(text: string): void;
  reasoning(text: string): void;
  tool(tool: { toolCallId?: string; name: string; input?: Record<string, unknown> }): void;
  toolResult(result: { toolCallId?: string; output: unknown }): void;
  done(result: CustomHarnessDone): void;
  error(error: Error | string, metadata?: Partial<Omit<CustomHarnessDone, "output">>): void;
  emit(event: string, data: unknown): void;
}

export type CustomHarnessHandler = (
  context: CustomHarnessContext,
  emit: CustomHarnessEmitter,
) => Promise<CustomHarnessDone | string | void> | CustomHarnessDone | string | void;

export interface RunCustomHarnessOptions {
  /** Defaults to process.argv.slice(2). Exposed for tests and embedded harnesses. */
  argv?: string[];
  /** Defaults to process.stdout.write. Exposed for tests and embedded harnesses. */
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

function createEmitter(write: (chunk: string) => void): CustomHarnessEmitter {
  const emit = (event: string, data: unknown) => {
    write(`event: ${event}\n`);
    write(`data: ${JSON.stringify(data)}\n\n`);
  };

  return {
    text: (text) => emit("text", { text }),
    reasoning: (text) => emit("thinking", { text }),
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
 * Implement a Box custom harness process.
 *
 * The backend runs your command with `-p <prompt> --model <model> --stream` and
 * optionally `--session <sessionId>`. This helper parses those arguments and
 * emits the `box-sse-v1` protocol expected by Box.
 *
 * @example
 * ```ts
 * import { runCustomHarness } from "@upstash/box";
 *
 * await runCustomHarness(async ({ prompt, model }, emit) => {
 *   emit.tool({ name: "custom_harness", input: { model } });
 *   const output = `received: ${prompt}`;
 *   emit.text(output);
 *   return { output, inputTokens: prompt.split(/\s+/).length, outputTokens: output.split(/\s+/).length };
 * });
 * ```
 */
export async function runCustomHarness(
  handler: CustomHarnessHandler,
  options: RunCustomHarnessOptions = {},
): Promise<void> {
  const argv = options.argv ?? process.argv.slice(2);
  const write = options.write ?? ((chunk: string) => process.stdout.write(chunk));
  const emit = createEmitter(write);
  const context: CustomHarnessContext = {
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
