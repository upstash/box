import type { Box } from "@upstash/box";

/**
 * Create a snapshot of the current box state.
 */
export async function handleSnapshot(box: Box, args: string): Promise<void> {
  const name = args.trim() || `snapshot-${Date.now()}`;
  const snapshot = await box.snapshot({ name });
  console.log(`Snapshot created: ${snapshot.id} (${snapshot.name})`);
}
