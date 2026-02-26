import type { Box } from "@upstash/box";
import type { BoxREPLEvent } from "../types.js";

/**
 * Delete the box. Yields an exit event to signal the REPL to stop.
 */
export async function* handleDelete(box: Box, _args: string): AsyncGenerator<BoxREPLEvent> {
  await box.delete();
  yield { type: "log", message: `Box ${box.id} deleted.` };
  yield { type: "exit", message: `Box ${box.id} deleted.` };
}
