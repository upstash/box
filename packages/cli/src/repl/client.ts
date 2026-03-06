import type { Box } from "@upstash/box";
import type { BoxREPLEvent, BoxREPLCommand, BoxREPLCommandName } from "./types.js";
import { handleRun } from "./commands/run.js";
import { handleCd } from "./commands/cd.js";
import { handleAgent } from "./commands/agent.js";
import { handleShell } from "./commands/shell.js";
import { handleFiles } from "./commands/files.js";
import { handleGit } from "./commands/git.js";
import { handleSnapshot } from "./commands/snapshot.js";
import { handlePause } from "./commands/pause.js";
import { handleDelete } from "./commands/delete.js";
import { handleConsole } from "./commands/console.js";
import { fuzzyMatch } from "../utils/fuzzy.js";
import { getNextSuggestion } from "./suggestions.js";

// Dummy handler for commands intercepted in handleInput()
async function* noop(): AsyncGenerator<BoxREPLEvent> {}

const COMMANDS: Record<BoxREPLCommandName, Omit<BoxREPLCommand, "name">> = {
  agent: { description: "Switch to agent mode", handler: handleAgent },
  shell: { description: "Switch to shell mode", handler: handleShell },
  cd: { description: "Change working directory", handler: handleCd },
  files: {
    description: "File operations (read, write, list, upload, download)",
    handler: handleFiles,
  },
  git: {
    description: "Git operations (clone, diff, status, commit, push, create-pr, exec, checkout)",
    handler: handleGit,
  },
  snapshot: { description: "Create a snapshot of the current box", handler: handleSnapshot },
  pause: { description: "Pause the box and exit", handler: handlePause },
  delete: { description: "Delete the box and exit", handler: handleDelete },
  console: { description: "Open the box in Upstash console", handler: handleConsole },
  clear: { description: "Clear terminal output", handler: noop },
  help: { description: "Show all commands", handler: noop },
  exit: { description: "Exit the REPL", handler: noop },
};

/** All available command names (without / prefix). */
export const COMMAND_NAMES = Object.keys(COMMANDS) as BoxREPLCommandName[];

/** Command descriptions for completer/preview. */
export const COMMAND_DESCRIPTIONS: Record<BoxREPLCommandName, string> = Object.fromEntries(
  COMMAND_NAMES.map((name) => [name, COMMANDS[name].description]),
) as Record<BoxREPLCommandName, string>;

export interface BoxREPLClientOptions {
  /** Commands to hide from suggestions, help output, and welcome message. */
  hiddenCommands?: BoxREPLCommandName[];
}

export class BoxREPLClient {
  readonly box: Box;
  readonly hiddenCommands: ReadonlySet<BoxREPLCommandName>;
  mode: "shell" | "agent" = "shell";
  private _suggestion: string | null = "ls";
  private _cwdEntries: string[] = [];

  constructor(box: Box, options?: BoxREPLClientOptions) {
    this.box = box;
    this.hiddenCommands = new Set(options?.hiddenCommands ?? []);
  }

  /** Refresh the cached list of files/directories in the current working directory. */
  async refreshCwdEntries(): Promise<void> {
    try {
      const run = await this.box.exec.command("ls -1 -p");
      const output = run.result ?? "";
      this._cwdEntries = output
        .split("\n")
        .map((e) => e.trim())
        .filter((e) => e.length > 0);
    } catch {
      this._cwdEntries = [];
    }
  }

  /** Return cwd entries that start with the given partial (case-insensitive). */
  getCompletions(partial: string): string[] {
    const lower = partial.toLowerCase();
    return this._cwdEntries.filter((e) => e.toLowerCase().startsWith(lower));
  }

  /**
   * The next suggested command (e.g. after a command completes).
   * In the terminal, Tab accepts the ghost text; any other key dismisses it.
   * Persists until the next call to handleInput replaces or clears it.
   */
  get suggestion(): string | null {
    return this._suggestion;
  }

  /** Label and display cwd for rendering prompts (CLI and UI). */
  get promptInfo(): { label: string; cwd: string } {
    const cwd = this.box.cwd;
    const display =
      cwd === "/home/boxuser"
        ? "~"
        : cwd.startsWith("/home/boxuser/")
          ? "~/" + cwd.slice("/home/boxuser/".length)
          : cwd;
    return {
      label: this.mode === "agent" ? "agent" : this.box.id,
      cwd: display,
    };
  }

  /** Parse input and return the matching command + args, or null. */
  private getCommand(input: string): { command: BoxREPLCommand; args: string } | null {
    const trimmed = input.trim();
    if (!trimmed.startsWith("/")) return null;

    const withoutSlash = trimmed.slice(1);
    const spaceIdx = withoutSlash.indexOf(" ");
    const cmdName = spaceIdx === -1 ? withoutSlash : withoutSlash.slice(0, spaceIdx);
    const args = spaceIdx === -1 ? "" : withoutSlash.slice(spaceIdx + 1).trim();

    const entry = COMMANDS[cmdName as BoxREPLCommandName];
    if (!entry) return null;

    return { command: { name: cmdName as BoxREPLCommandName, ...entry }, args };
  }

  /** Return commands whose name starts with the given prefix, excluding hidden ones and current mode. */
  suggestCommands(prefix: string): BoxREPLCommand[] {
    return COMMAND_NAMES.filter(
      (name) =>
        name.startsWith(prefix) &&
        !this.hiddenCommands.has(name) &&
        !(name === "shell" && this.mode === "shell") &&
        !(name === "agent" && this.mode === "agent"),
    ).map((name) => ({ name, ...COMMANDS[name] }));
  }

  /** Execute a shell command in the box, streaming output in real time. */
  private async *execShellCommand(command: string): AsyncGenerator<BoxREPLEvent> {
    for await (const chunk of this.box.exec.stream(command)) {
      if (chunk.type === "output") {
        yield { type: "stream", text: chunk.data };
      }
    }
  }

  /** Process a single line of input and yield events. */
  async *handleInput(input: string): AsyncGenerator<BoxREPLEvent> {
    const trimmed = input.trim();
    if (!trimmed) return;

    if (trimmed === "exit" || trimmed === "/exit") {
      yield { type: "exit", message: "Goodbye." };
      return;
    }

    if (trimmed === "/clear" || trimmed === "clear") {
      yield { type: "clear" };
      return;
    }

    if (trimmed === "/help") {
      const lines = COMMAND_NAMES.filter((name) => !this.hiddenCommands.has(name))
        .map((name) => `  /${name.padEnd(16)}${COMMANDS[name].description}`)
        .join("\n");
      yield { type: "log", message: `\nAvailable commands:\n${lines}\n` };
      return;
    }

    if (trimmed.startsWith("/")) {
      const parsed = this.getCommand(trimmed);

      if (parsed) {
        const { command, args } = parsed;

        // Toggle mode before running the handler
        if (command.name === "agent") {
          this.mode = "agent";
          this._suggestion = getNextSuggestion({ kind: "agent", initial: true });
        } else if (command.name === "shell") {
          this.mode = "shell";
          this._suggestion = getNextSuggestion({ kind: "shell", input: "ls" });
        } else {
          this._suggestion = getNextSuggestion({ kind: "command", command: command.name });
        }

        yield { type: "command:start", command: command.name, args };
        const start = Date.now();
        try {
          yield* command.handler(this.box, args);
          const durationMs = Date.now() - start;
          yield { type: "command:complete", command: command.name, durationMs };
          if (command.name === "cd") this.refreshCwdEntries();
        } catch (err) {
          yield { type: "error", message: `Error: ${err instanceof Error ? err.message : err}` };
        }
      } else {
        const withoutSlash = trimmed.slice(1);
        const spaceIdx = withoutSlash.indexOf(" ");
        const cmdName = spaceIdx === -1 ? withoutSlash : withoutSlash.slice(0, spaceIdx);
        const suggestions = fuzzyMatch(cmdName, COMMAND_NAMES) as BoxREPLCommandName[];
        yield { type: "command:not-found", typed: cmdName, suggestions };
      }
    } else {
      // No / prefix — behavior depends on current mode

      // Intercept bare `cd <path>` (single arg) as /cd
      if (trimmed.startsWith("cd ") || trimmed === "cd") {
        const afterCd = trimmed.slice(2).trim();
        // Single argument (no spaces, no &&, no ;, no |) → treat as /cd
        if (afterCd && !afterCd.includes(" ") && !/[;&|]/.test(afterCd)) {
          yield { type: "command:start", command: "cd", args: afterCd };
          const start = Date.now();
          try {
            yield* handleCd(this.box, afterCd);
            const durationMs = Date.now() - start;
            yield { type: "command:complete", command: "cd", durationMs };
            this.refreshCwdEntries();
          } catch (err) {
            yield {
              type: "error",
              message: `Error: ${err instanceof Error ? err.message : err}`,
            };
          }
          return;
        }
      }

      if (this.mode === "shell") {
        this._suggestion = getNextSuggestion({ kind: "shell", input: trimmed });
        yield { type: "command:start", command: "shell", args: trimmed };
        const start = Date.now();
        try {
          yield* this.execShellCommand(trimmed);
          const durationMs = Date.now() - start;
          yield { type: "command:complete", command: "shell", durationMs };

          // Warn if input contained cd with extra args (multi-arg cd)
          if (trimmed.startsWith("cd ")) {
            yield {
              type: "log",
              message: "Tip: use just 'cd <path>' to change the working directory",
            };
          }
        } catch (err) {
          yield { type: "error", message: `Error: ${err instanceof Error ? err.message : err}` };
        }
      } else {
        // Agent mode
        this._suggestion = getNextSuggestion({ kind: "agent", initial: false });
        yield { type: "command:start", command: "agent", args: trimmed };
        const start = Date.now();
        try {
          yield* handleRun(this.box, trimmed);
          const durationMs = Date.now() - start;
          yield { type: "command:complete", command: "agent", durationMs };
        } catch (err) {
          yield { type: "error", message: `Error: ${err instanceof Error ? err.message : err}` };
        }
      }
    }
  }
}
