import type { BoxREPLEvent } from "../types.js";

/**
 * Handler for /shell — confirmation message only.
 * Mode toggle is performed by handleInput() in client.ts.
 */
export async function* handleShell(_box: unknown, _args: string): AsyncGenerator<BoxREPLEvent> {
  yield { type: "log", message: "Switched to shell mode" };
}
