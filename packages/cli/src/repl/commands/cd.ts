import type { Box } from "@upstash/box";
import type { BoxREPLEvent } from "../types.js";

/**
 * Change the in-memory working directory.
 */
export async function* handleCd(box: Box, args: string): AsyncGenerator<BoxREPLEvent> {
  const path = args.trim();
  if (!path) {
    yield { type: "log", message: box.cwd };
    return;
  }
  await box.cd(path);
  yield { type: "log", message: box.cwd };
}
