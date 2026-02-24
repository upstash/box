import type { Box } from "@upstash/box";
import type { REPLHooks } from "../repl-client.js";

/**
 * Delete the box. Returns true to signal the REPL to exit.
 */
export async function handleDelete(box: Box, _args: string, hooks: REPLHooks): Promise<boolean> {
  await box.delete();
  hooks.onLog(`Box ${box.id} deleted.`);
  return true;
}
