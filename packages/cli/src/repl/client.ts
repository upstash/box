import type { Box } from "@upstash/box";
import type { BoxREPLEvent, BoxREPLCommand, BoxREPLCommandName } from "./types.js";
import { handleRun } from "./commands/run.js";
import { handleExec } from "./commands/exec.js";
import { handleFiles } from "./commands/files.js";
import { handleGit } from "./commands/git.js";
import { handleSnapshot } from "./commands/snapshot.js";
import { handlePause } from "./commands/pause.js";
import { handleDelete } from "./commands/delete.js";
import { handleConsole } from "./commands/console.js";
import { fuzzyMatch } from "../utils/fuzzy.js";

const COMMANDS: Record<BoxREPLCommandName, Omit<BoxREPLCommand, "name">> = {
  run: { description: "Run the agent with a prompt", handler: handleRun },
  exec: { description: "Execute a shell command", handler: handleExec },
  files: { description: "File operations (read, write, list, upload, download)", handler: handleFiles },
  git: { description: "Git operations (clone, diff, create-pr)", handler: handleGit },
  snapshot: { description: "Create a snapshot of the current box", handler: handleSnapshot },
  pause: { description: "Pause the box and exit", handler: handlePause },
  delete: { description: "Delete the box and exit", handler: handleDelete },
  console: { description: "Open the box in Upstash console", handler: handleConsole },
};

/** All available command names (without / prefix). */
export const COMMAND_NAMES = Object.keys(COMMANDS) as BoxREPLCommandName[];

/** Command descriptions for completer/preview. */
export const COMMAND_DESCRIPTIONS: Record<BoxREPLCommandName, string> = Object.fromEntries(
  COMMAND_NAMES.map((name) => [name, COMMANDS[name].description]),
) as Record<BoxREPLCommandName, string>;

/** Context-aware suggestion after a command completes. */
function getNextCommandSuggestion(cmdName: BoxREPLCommandName): string | undefined {
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

  constructor(box: Box) {
    this.box = box;
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

  /** Return commands whose name starts with the given prefix. */
  static suggestCommands(prefix: string): BoxREPLCommand[] {
    return COMMAND_NAMES.filter((name) => name.startsWith(prefix)).map((name) => ({
      name,
      ...COMMANDS[name],
    }));
  }

  /** Process a single line of input and yield events. */
  async *handleInput(input: string): AsyncGenerator<BoxREPLEvent> {
    const trimmed = input.trim();
    if (!trimmed) return;

    if (trimmed === "exit" || trimmed === "/exit") {
      yield { type: "exit", message: "Goodbye." };
      return;
    }

    if (trimmed.startsWith("/")) {
      const parsed = this.getCommand(trimmed);

      if (parsed) {
        const { command, args } = parsed;
        yield { type: "command:start", command: command.name, args };
        const start = Date.now();
        try {
          yield* command.handler(this.box, args);
          const durationMs = Date.now() - start;
          yield { type: "command:complete", command: command.name, durationMs };
          const suggestion = getNextCommandSuggestion(command.name);
          if (suggestion) yield { type: "suggestion", text: suggestion };
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
      // No / prefix — treat as agent prompt
      yield { type: "command:start", command: "run", args: trimmed };
      const start = Date.now();
      try {
        yield* handleRun(this.box, trimmed);
        const durationMs = Date.now() - start;
        yield { type: "command:complete", command: "run", durationMs };
        yield { type: "suggestion", text: "/snapshot" };
      } catch (err) {
        yield { type: "error", message: `Error: ${err instanceof Error ? err.message : err}` };
      }
    }
  }
}
