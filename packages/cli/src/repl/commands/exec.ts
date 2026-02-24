import type { Box } from "@upstash/box";
import type { REPLHooks } from "../client.js";

/**
 * Execute a shell command in the box.
 */
export async function handleExec(box: Box, command: string, hooks: REPLHooks): Promise<void> {
  if (!command) {
    hooks.onLog("Usage: exec <command>");
    return;
  }
  const run = await box.exec(command);
  const result = await run.result();
  if (result) hooks.onLog(result);
}
