import type { Box } from "@upstash/box";
import type { BoxREPLEvent } from "../types.js";

/**
 * Create a snapshot of the current box state.
 */
export async function* handleSnapshot(box: Box, args: string): AsyncGenerator<BoxREPLEvent> {
  const name = args.trim() || `snapshot-${Date.now()}`;
  const snapshot = await box.snapshot({ name });
  yield { type: "log", message: `Snapshot created: ${snapshot.id} (${snapshot.name})` };
}
