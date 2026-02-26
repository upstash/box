import type { Box } from "@upstash/box";
import type { BoxREPLEvent } from "../types.js";

/**
 * Pause the box. Yields an exit event to signal the REPL to stop.
 */
export async function* handlePause(box: Box, _args: string): AsyncGenerator<BoxREPLEvent> {
  await box.pause();
  yield { type: "log", message: `Box ${box.id} paused.` };
  yield { type: "exit", message: `Box ${box.id} paused.` };
}
