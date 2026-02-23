import type { Box } from "@upstash/box";

/**
 * Pause the box. Returns true to signal the REPL to exit.
 */
export async function handlePause(box: Box, _args: string): Promise<boolean> {
  await box.pause();
  console.log(`Box ${box.id} paused.`);
  return true;
}
