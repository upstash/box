import { exec } from "node:child_process";
import type { Box } from "@upstash/box";
import type { REPLHooks } from "../client.js";

const UPSTASH_CONSOLE_URL = "https://console.upstash.com/box/resolve";

/**
 * Open the Upstash console for the current box in the default browser.
 */
export async function handleConsole(box: Box, _args: string, hooks: REPLHooks): Promise<void> {
  const url = `${UPSTASH_CONSOLE_URL}/${box.id}`;

  const openCmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";

  exec(`${openCmd} ${url}`, (err) => {
    if (err) {
      hooks.onError(`Failed to open browser: ${err.message}`);
      return;
    }
  });

  hooks.onLog(`Opening ${url}`);
}
