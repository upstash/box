import type { BoxREPLEvent } from "../types.js";

/**
 * Handler for /agent — confirmation message only.
 * Mode toggle is performed by handleInput() in client.ts.
 */
export async function* handleAgent(_box: unknown, _args: string): AsyncGenerator<BoxREPLEvent> {
  yield { type: "log", message: "Switched to agent mode" };
}
