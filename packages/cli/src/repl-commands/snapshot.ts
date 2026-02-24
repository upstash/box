import type { Box } from "@upstash/box";
import type { REPLHooks } from "../repl-client.js";

/**
 * Create a snapshot of the current box state.
 */
export async function handleSnapshot(box: Box, args: string, hooks: REPLHooks): Promise<void> {
  const name = args.trim() || `snapshot-${Date.now()}`;
  const snapshot = await box.snapshot({ name });
  hooks.onLog(`Snapshot created: ${snapshot.id} (${snapshot.name})`);
}
