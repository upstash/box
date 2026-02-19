import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { Box } from "@upstash/box";
import { handleRun } from "./repl-commands/run.js";
import { handleExec } from "./repl-commands/exec.js";
import { handleFiles } from "./repl-commands/files.js";
import { handleGit } from "./repl-commands/git.js";
import { handleSnapshot } from "./repl-commands/snapshot.js";
import { handleStop } from "./repl-commands/stop.js";
import { handleDelete } from "./repl-commands/delete.js";

const COMMANDS: Record<string, (box: Box, args: string) => Promise<boolean | void>> = {
  run: handleRun,
  exec: handleExec,
  files: handleFiles,
  git: handleGit,
  snapshot: handleSnapshot,
  stop: handleStop,
  delete: handleDelete,
};

/**
 * Start an interactive REPL session for the given box.
 */
export async function startRepl(box: Box): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  console.log(`\nConnected to box ${box.id}`);
  console.log(`Type a prompt to run the agent, or use commands: ${Object.keys(COMMANDS).join(", ")}, exit\n`);

  try {
    while (true) {
      const input = await rl.question(`${box.id}> `);
      const trimmed = input.trim();
      if (!trimmed) continue;

      if (trimmed === "exit" || trimmed === "/exit") {
        console.log("Goodbye.");
        break;
      }

      // Strip leading slash if present
      const normalized = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;

      // Find matching command
      const spaceIdx = normalized.indexOf(" ");
      const cmdName = spaceIdx === -1 ? normalized : normalized.slice(0, spaceIdx);
      const args = spaceIdx === -1 ? "" : normalized.slice(spaceIdx + 1).trim();

      const handler = COMMANDS[cmdName];
      if (handler) {
        try {
          const shouldExit = await handler(box, args);
          if (shouldExit === true) break;
        } catch (err) {
          console.error(`Error: ${err instanceof Error ? err.message : err}`);
        }
      } else {
        // Bare text → implicit run
        try {
          await handleRun(box, trimmed);
        } catch (err) {
          console.error(`Error: ${err instanceof Error ? err.message : err}`);
        }
      }
    }
  } finally {
    rl.close();
  }
}
