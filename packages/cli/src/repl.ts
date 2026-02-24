import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { Box } from "@upstash/box";
import { BoxREPLClient } from "./repl-client.js";

/**
 * Start an interactive REPL session for the given box (CLI entry point).
 */
export async function startRepl(box: Box): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });

  const client = new BoxREPLClient({
    box,
    promptUser: (prompt) => rl.question(prompt),
    hooks: {
      onLog: (message) => console.log(message),
      onError: (message) => console.error(message),
      onStream: (chunk) => process.stdout.write(chunk),
    },
  });

  try {
    await client.startLoop();
  } finally {
    rl.close();
  }
}
