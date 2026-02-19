import type { Box } from "@buggyhunter/box";

/**
 * Delete the box. Returns true to signal the REPL to exit.
 */
export async function handleDelete(box: Box, _args: string): Promise<boolean> {
  await box.delete();
  console.log(`Box ${box.id} deleted.`);
  return true;
}
