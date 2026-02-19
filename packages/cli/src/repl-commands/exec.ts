import type { Box } from "@buggyhunter/box";

/**
 * Execute a shell command in the box.
 */
export async function handleExec(box: Box, command: string): Promise<void> {
  if (!command) {
    console.log("Usage: exec <command>");
    return;
  }
  const run = await box.exec(command);
  const result = await run.result();
  if (result) console.log(result);
}
