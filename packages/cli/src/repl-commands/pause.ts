import type { Box } from "@upstash/box";
import type { REPLHooks } from "../repl-client.js";

/**
 * Pause the box. Returns true to signal the REPL to exit.
 */
export async function handlePause(box: Box, _args: string, hooks: REPLHooks): Promise<boolean> {
  await box.pause();
  hooks.onLog(`Box ${box.id} paused.`);
  return true;
}
