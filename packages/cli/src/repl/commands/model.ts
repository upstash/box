import type { Box } from "@upstash/box";
import type { BoxREPLEvent } from "../types.js";

/**
 * /model [runner] [model]
 *
 * With args:  directly set the model via the config API.
 * Without args: yield a model-picker event for the terminal/UI to handle.
 */
export async function* handleModel(box: Box, args: string): AsyncGenerator<BoxREPLEvent> {
  const parts = args.trim().split(/\s+/);

  if (parts.length < 2) {
    yield {
      type: "error",
      message: "Usage: /model <runner> <model>  (e.g. /model claude-code claude/opus_4_5)",
    };
    return;
  }

  const model = parts[1]!;

  await box.configureModel(model);
  yield { type: "log", message: `Model changed to ${model}` };
}
