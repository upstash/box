import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { Box } from "@upstash/box";
import { BoxREPLClient, COMMAND_NAMES, COMMAND_DESCRIPTIONS } from "./client.js";
import { startSpinner } from "./spinner.js";
import {
  bold,
  cyan,
  dim,
  green,
  red,
  yellow,
  cursorUp,
  eraseLine,
  eraseDown,
  stripAnsi,
} from "../utils/ansi.js";

/**
 * Start an interactive REPL session for the given box (CLI entry point).
 */
export async function startRepl(box: Box): Promise<void> {
  const rl = createInterface({
    input: stdin,
    output: stdout,
    completer: (): [string[], string] => [[], ""],
  });

  const prompt = `${bold(cyan(box.id))}${dim(">")} `;

  // --- Spinner tracking ---
  let activeSpinnerStop: (() => void) | null = null;

  function ensureSpinnerStopped() {
    if (activeSpinnerStop) {
      activeSpinnerStop();
      activeSpinnerStop = null;
    }
  }

  // --- Command preview while typing ---
  let previewLines = 0;
  const promptVisualLen = stripAnsi(prompt).length;

  function restoreCursorColumn() {
    const cursor = (rl as unknown as { cursor: number }).cursor ?? 0;
    const col = promptVisualLen + cursor;
    // \x1b[<n>G = cursor horizontal absolute (1-indexed)
    stdout.write(`\x1b[${col + 1}G`);
  }

  function clearPreview() {
    if (previewLines > 0) {
      // Move one line below input, erase everything from there down,
      // then move back up. Uses relative movement so it's scroll-safe.
      stdout.write("\n" + eraseDown + cursorUp(1));
      restoreCursorColumn();
      previewLines = 0;
    }
  }

  // --- Ghost suggestion in input ---
  let nextSuggestion: string | null = "/exec ls";
  let ghostText: string | null = null;

  function showGhost(text: string) {
    ghostText = text;
    stdout.write(dim(text));
    // Move cursor back to just after the prompt
    stdout.write(`\x1b[${text.length}D`);
  }

  if (stdin.isTTY) {
    // Must run before readline's handler so the cursor is still on the input line
    stdin.prependListener("keypress", (_str: string, key: { name?: string }) => {
      if (key?.name === "return") {
        clearPreview();
      }
    });

    stdin.on("keypress", (_str: string, key: { name?: string }) => {
      // Handle ghost text: Tab accepts, any other key dismisses
      if (ghostText) {
        if (key?.name === "tab") {
          const text = ghostText;
          ghostText = null;
          rl.write(text);
          return;
        }
        ghostText = null;
        // Erase leftover ghost text after cursor
        setImmediate(() => {
          stdout.write("\x1b[K");
          restoreCursorColumn();
        });
      }

      // Command preview logic (deferred so rl.line is up to date)
      setImmediate(() => {
        const line = (rl as unknown as { line: string }).line ?? "";
        clearPreview();

        if (line.startsWith("/") && !line.includes(" ")) {
          const partial = line.slice(1);
          const matches = COMMAND_NAMES.filter((c) => c.startsWith(partial)).slice(0, 5);
          if (matches.length > 0) {
            const preview = matches
              .map((c) => `  ${dim(`/${c}`)} ${dim("—")} ${dim(COMMAND_DESCRIPTIONS[c] ?? "")}`)
              .join("\n");
            stdout.write("\n" + preview + cursorUp(matches.length));
            restoreCursorColumn();
            previewLines = matches.length;
          }
        }
      });
    });
  }

  const client = new BoxREPLClient({
    box,
    promptUser: () => {
      clearPreview();
      const suggestion = nextSuggestion;
      nextSuggestion = null;

      const promise = rl.question(prompt).then((input) => {
        // Rewrite the prompt line with the input in green
        if (input.trim()) {
          stdout.write(`\x1b[A\r${eraseLine}${prompt}${green(input)}\n`);
        }
        return input;
      });

      if (suggestion && stdin.isTTY) {
        setImmediate(() => showGhost(suggestion));
      }

      return promise;
    },
    hooks: {
      onLog: (message) => {
        ensureSpinnerStopped();
        clearPreview();
        console.log(message);
      },
      onError: (message) => {
        ensureSpinnerStopped();
        clearPreview();
        console.error(red(message));
      },
      onStream: (chunk) => {
        ensureSpinnerStopped();
        process.stdout.write(chunk);
      },

      onLoadingStart: () => {
        stdout.write("\n");
        const stop = startSpinner();
        activeSpinnerStop = stop;
        return stop;
      },

      onSuggestion: (text) => {
        nextSuggestion = text;
      },

      onCommandComplete: (command, durationMs) => {
        const seconds = (durationMs / 1000).toFixed(1);
        console.log(dim(`\n  /${command} completed in ${seconds}s\n`));
      },

      onCommandNotFound: (typed, suggestions) => {
        console.error(yellow(`\nUnknown command: /${typed}`));
        if (suggestions.length > 0) {
          console.log(yellow(`Did you mean: ${suggestions.map((s) => `/${s}`).join(", ")}?\n`));
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
