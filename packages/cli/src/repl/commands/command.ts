import type { Box } from "@upstash/box";
import type { BoxREPLEvent } from "../types.js";

/**
 * Execute a shell command in the box.
 */
export async function* handleCommand(box: Box, command: string): AsyncGenerator<BoxREPLEvent> {
  if (!command) {
    yield { type: "log", message: "Usage: /command <command>" };
    return;
  }
  const run = await box.exec.command(command);
  const result = run.result;
  if (result) yield { type: "log", message: result };
}
