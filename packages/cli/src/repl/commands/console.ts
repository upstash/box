import type { Box } from "@upstash/box";
import type { BoxREPLEvent } from "../types.js";

const UPSTASH_CONSOLE_URL = "https://console.upstash.com/box/resolve";

/**
 * Open the Upstash console for the current box in the default browser.
 * Yields an open-url event; the consumer handles actually opening the browser.
 */
export async function* handleConsole(box: Box, _args: string): AsyncGenerator<BoxREPLEvent> {
  const url = `${UPSTASH_CONSOLE_URL}/${box.id}`;
  yield { type: "open-url", url };
  yield { type: "log", message: `Opening ${url}` };
}
