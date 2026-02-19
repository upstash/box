import type { Box } from "@buggyhunter/box";

/**
 * Stop the box. Returns true to signal the REPL to exit.
 */
export async function handleStop(box: Box, _args: string): Promise<boolean> {
  await box.stop();
  console.log(`Box ${box.id} stopped.`);
  return true;
}
