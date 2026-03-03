import type { Box } from "@upstash/box";
import type { BoxREPLEvent } from "../types.js";

/**
 * Change the in-memory working directory.
 */
export async function* handleCd(box: Box, args: string): AsyncGenerator<BoxREPLEvent> {
  const path = args.trim();
  if (!path) {
    return;
  }
  await box.cd(path);
}
