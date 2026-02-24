import { createInterface, type Interface as ReadlineInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { Box } from "@upstash/box";
import { BoxREPLClient, COMMAND_NAMES, COMMAND_DESCRIPTIONS } from "./client.js";
import { startSpinner } from "./spinner.js";
import {
  bold,
  cyan,
  dim,
  red,
  yellow,
  cursorSave,
  cursorRestore,
  eraseLine,
  eraseDown,
} from "../utils/ansi.js";

/**
 * Tab completer for readline: matches /commands.
 */
function completer(line: string): [string[], string] {
  if (line.startsWith("/")) {
    const partial = line.slice(1);
    const matches = COMMAND_NAMES.filter((c) => c.startsWith(partial)).map((c) => `/${c}`);
    // Also include /exit
    if ("exit".startsWith(partial)) matches.push("/exit");
    return [matches, line];
  }
  return [[], line];
}

/**
 * Start an interactive REPL session for the given box (CLI entry point).
 */
export async function startRepl(box: Box): Promise<void> {
  const rl = createInterface({
    input: stdin,
    output: stdout,
    completer: completer as unknown as (line: string) => [string[], string],
  });

  const prompt = `${bold(cyan(box.id))}${dim(">")} `;

  // --- Command preview while typing ---
  let previewVisible = false;

  function clearPreview() {
    if (previewVisible) {
      stdout.write(cursorSave + "\n" + eraseLine + eraseDown + cursorRestore);
      previewVisible = false;
    }
  }

  if (stdin.isTTY) {
    stdin.on("keypress", () => {
      // Small delay so rl.line is updated
      setImmediate(() => {
        const line = (rl as unknown as { line: string }).line ?? "";
        clearPreview();

        if (line.startsWith("/") && line.length > 1) {
          const partial = line.slice(1).split(" ")[0] ?? "";
          const matches = COMMAND_NAMES.filter((c) => c.startsWith(partial));
          if (matches.length > 0 && matches.length <= 5) {
            const preview = matches
              .map((c) => `  ${dim(`/${c}`)} ${dim("—")} ${dim(COMMAND_DESCRIPTIONS[c] ?? "")}`)
              .join("\n");
            stdout.write(cursorSave + "\n" + preview + cursorRestore);
            previewVisible = true;
          }
        }
      });
    });
  }

  // --- Suggestion state ---
  let pendingSuggestion: string | null = null;

  function showSuggestion(text: string) {
    pendingSuggestion = text;
    stdout.write(`\n${dim(text)}\n`);
  }

  const client = new BoxREPLClient({
    box,
    promptUser: (defaultPrompt) => {
      clearPreview();
      pendingSuggestion = null;
      return rl.question(prompt);
    },
    hooks: {
      onLog: (message) => {
        clearPreview();
        console.log(message);
      },
      onError: (message) => {
        clearPreview();
        console.error(red(message));
      },
      onStream: (chunk) => process.stdout.write(chunk),

      onLoadingStart: () => startSpinner(),

      onSuggestion: (text) => showSuggestion(text),

      onCommandComplete: (command, durationMs) => {
        const seconds = (durationMs / 1000).toFixed(1);
        console.log(dim(`  /${command} completed in ${seconds}s`));
      },

      onCommandNotFound: (typed, suggestions) => {
        console.error(red(`Unknown command: /${typed}`));
        if (suggestions.length > 0) {
          console.log(yellow(`Did you mean: ${suggestions.map((s) => `/${s}`).join(", ")}?`));
        }
      },
    },
  });

  try {
    await client.startLoop();
  } finally {
    clearPreview();
    rl.close();
  }
}
