import type { Box } from "@upstash/box";
import { handleRun } from "./repl-commands/run.js";
import { handleExec } from "./repl-commands/exec.js";
import { handleFiles } from "./repl-commands/files.js";
import { handleGit } from "./repl-commands/git.js";
import { handleSnapshot } from "./repl-commands/snapshot.js";
import { handlePause } from "./repl-commands/pause.js";
import { handleDelete } from "./repl-commands/delete.js";

export type REPLHooks = {
  onLog: (message: string) => void;
  onError: (message: string) => void;
  onStream: (message: string) => void;
};

const COMMANDS: Record<
  string,
  (box: Box, args: string, hooks: REPLHooks) => Promise<boolean | void>
> = {
  run: handleRun,
  exec: handleExec,
  files: handleFiles,
  git: handleGit,
  snapshot: handleSnapshot,
  pause: handlePause,
  delete: handleDelete,
};

export class BoxREPLClient {
  readonly box: Box;
  readonly promptUser: (prompt: string) => Promise<string>;
  readonly onLog: (message: string) => void;
  readonly onError: (message: string) => void;
  readonly onStream: (message: string) => void;

  constructor({
    box,
    promptUser,
    hooks: { onLog, onError, onStream },
  }: {
    box: Box;
    promptUser: (prompt: string) => Promise<string>;
    hooks: {
      onLog: (message: string) => void;
      onError: (message: string) => void;
      onStream: (message: string) => void;
    };
  }) {
    this.box = box;
    this.promptUser = promptUser;
    this.onLog = onLog;
    this.onError = onError;
    this.onStream = onStream;
  }

  async startLoop(): Promise<void> {
    const hooks: REPLHooks = {
      onLog: this.onLog,
      onError: this.onError,
      onStream: this.onStream,
    };

    this.onLog(`\nConnected to box ${this.box.id}`);
    this.onLog(
      `Type a prompt to run the agent, or use commands: ${Object.keys(COMMANDS).join(", ")}, exit\n`,
    );

    while (true) {
      const input = await this.promptUser(`${this.box.id}> `);
      const trimmed = input.trim();
      if (!trimmed) continue;

      if (trimmed === "exit" || trimmed === "/exit") {
        this.onLog("Goodbye.");
        break;
      }

      const normalized = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
      const spaceIdx = normalized.indexOf(" ");
      const cmdName = spaceIdx === -1 ? normalized : normalized.slice(0, spaceIdx);
      const args = spaceIdx === -1 ? "" : normalized.slice(spaceIdx + 1).trim();

      const handler = COMMANDS[cmdName];
      if (handler) {
        try {
          const shouldExit = await handler(this.box, args, hooks);
          if (shouldExit === true) break;
        } catch (err) {
          this.onError(`Error: ${err instanceof Error ? err.message : err}`);
        }
      } else {
        try {
          await handleRun(this.box, trimmed, hooks);
        } catch (err) {
          this.onError(`Error: ${err instanceof Error ? err.message : err}`);
        }
      }
    }
  }
}
