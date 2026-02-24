import type { Box } from "@upstash/box";
import { handleRun } from "./commands/run.js";
import { handleExec } from "./commands/exec.js";
import { handleFiles } from "./commands/files.js";
import { handleGit } from "./commands/git.js";
import { handleSnapshot } from "./commands/snapshot.js";
import { handlePause } from "./commands/pause.js";
import { handleDelete } from "./commands/delete.js";
import { fuzzyMatch } from "../utils/fuzzy.js";

export type REPLHooks = {
  // Required — core functionality
  onLog: (message: string) => void;
  onError: (message: string) => void;
  onStream: (message: string) => void;

  // Optional — each hook's presence enables its feature

  /** Loading indicator. Return a stop() function. */
  onLoadingStart?: () => () => void;

  /** Post-command suggestion (e.g. "try: /snapshot"). */
  onSuggestion?: (text: string) => void;

  /** Timing info after each command. */
  onCommandComplete?: (command: string, durationMs: number) => void;

  /** Unknown /command with fuzzy suggestions. Falls back to onError if absent. */
  onCommandNotFound?: (typed: string, suggestions: string[]) => void;
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

/** All available command names (without / prefix). */
export const COMMAND_NAMES = Object.keys(COMMANDS);

/** Command descriptions for completer/preview. */
export const COMMAND_DESCRIPTIONS: Record<string, string> = {
  run: "Run the agent with a prompt",
  exec: "Execute a shell command",
  files: "File operations (read, write, list, upload, download)",
  git: "Git operations (clone, diff, create-pr)",
  snapshot: "Create a snapshot of the current box",
  pause: "Pause the box and exit",
  delete: "Delete the box and exit",
};

/** Context-aware suggestion after a command completes. */
function getSuggestion(cmdName: string): string | undefined {
  switch (cmdName) {
    case "exec":
      return "/files list .";
    case "run":
      return "/snapshot";
    case "files":
      return "/exec ls";
    case "git":
      return "/snapshot";
    case "snapshot":
      return "/pause";
    default:
      return undefined;
  }
}

export class BoxREPLClient {
  readonly box: Box;
  readonly promptUser: (prompt: string) => Promise<string>;
  private readonly hooks: REPLHooks;

  constructor({
    box,
    promptUser,
    hooks,
  }: {
    box: Box;
    promptUser: (prompt: string) => Promise<string>;
    hooks: REPLHooks;
  }) {
    this.box = box;
    this.promptUser = promptUser;
    this.hooks = hooks;
  }

  async startLoop(): Promise<void> {
    const { hooks } = this;

    hooks.onLog(`\nConnected to box ${this.box.id}`);
    hooks.onLog(
      `Type a prompt to run the agent, or use commands: ${COMMAND_NAMES.map((c) => `/${c}`).join(", ")}, /exit\n`,
    );

    while (true) {
      const input = await this.promptUser(`${this.box.id}> `);
      const trimmed = input.trim();
      if (!trimmed) continue;

      if (trimmed === "exit" || trimmed === "/exit") {
        hooks.onLog("Goodbye.");
        break;
      }

      // Commands require / prefix
      if (trimmed.startsWith("/")) {
        const withoutSlash = trimmed.slice(1);
        const spaceIdx = withoutSlash.indexOf(" ");
        const cmdName = spaceIdx === -1 ? withoutSlash : withoutSlash.slice(0, spaceIdx);
        const args = spaceIdx === -1 ? "" : withoutSlash.slice(spaceIdx + 1).trim();

        const handler = COMMANDS[cmdName];
        if (handler) {
          const start = Date.now();
          const stopLoading = hooks.onLoadingStart?.();
          try {
            const shouldExit = await handler(this.box, args, hooks);
            stopLoading?.();
            const durationMs = Date.now() - start;
            hooks.onCommandComplete?.(cmdName, durationMs);
            const suggestion = getSuggestion(cmdName);
            if (suggestion) hooks.onSuggestion?.(suggestion);
            if (shouldExit === true) break;
          } catch (err) {
            stopLoading?.();
            hooks.onError(`Error: ${err instanceof Error ? err.message : err}`);
          }
        } else {
          // Unknown command — fuzzy match
          const suggestions = fuzzyMatch(cmdName, COMMAND_NAMES);
          if (hooks.onCommandNotFound) {
            hooks.onCommandNotFound(cmdName, suggestions);
          } else {
            const msg =
              suggestions.length > 0
                ? `Unknown command: /${cmdName}. Did you mean: ${suggestions.map((s) => `/${s}`).join(", ")}?`
                : `Unknown command: /${cmdName}. Available: ${COMMAND_NAMES.map((c) => `/${c}`).join(", ")}`;
            hooks.onError(msg);
          }
        }
      } else {
        // No / prefix — treat as agent prompt
        const start = Date.now();
        const stopLoading = hooks.onLoadingStart?.();
        try {
          await handleRun(this.box, trimmed, hooks);
          stopLoading?.();
          const durationMs = Date.now() - start;
          hooks.onCommandComplete?.("run", durationMs);
          hooks.onSuggestion?.("/snapshot");
        } catch (err) {
          stopLoading?.();
          hooks.onError(`Error: ${err instanceof Error ? err.message : err}`);
        }
      }
    }
  }
}
