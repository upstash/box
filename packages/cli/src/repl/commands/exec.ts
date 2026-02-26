import type { Box } from "@upstash/box";
import type { BoxREPLEvent } from "../types.js";

/**
 * Execute a shell command in the box.
 */
export async function* handleExec(box: Box, command: string): AsyncGenerator<BoxREPLEvent> {
  if (!command) {
    yield { type: "log", message: "Usage: exec <command>" };
    return;
  }
  const run = await box.exec(command);
  const result = run.result;
  if (result) yield { type: "log", message: result };
}
