import { exec } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { Box } from "@upstash/box";
import type { BoxREPLEvent } from "./types.js";
import { BoxREPLClient } from "./client.js";
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
  const client = new BoxREPLClient(box);

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
          const matches = BoxREPLClient.suggestCommands(partial).slice(0, 5);
          if (matches.length > 0) {
            const preview = matches
              .map((c) => `  ${dim(`/${c.name}`)} ${dim("—")} ${dim(c.description)}`)
              .join("\n");
            stdout.write("\n" + preview + cursorUp(matches.length));
            restoreCursorColumn();
            previewLines = matches.length;
          }
        }
      });
    });
  }

  /** Map a single event to terminal actions. Returns true if the loop should exit. */
  function processEvent(event: BoxREPLEvent): boolean {
    switch (event.type) {
      case "command:start":
        stdout.write("\n");
        activeSpinnerStop = startSpinner();
        break;
      case "log":
        ensureSpinnerStopped();
        clearPreview();
        console.log(event.message);
        break;
      case "error":
        ensureSpinnerStopped();
        clearPreview();
        console.error(red(event.message));
        break;
      case "stream":
        ensureSpinnerStopped();
        process.stdout.write(event.text);
        break;
      case "command:complete": {
        const seconds = (event.durationMs / 1000).toFixed(1);
        console.log(dim(`\n  /${event.command} completed in ${seconds}s\n`));
        break;
      }
      case "suggestion":
        nextSuggestion = event.text;
        break;
      case "command:not-found":
        console.error(yellow(`\nUnknown command: /${event.typed}`));
        if (event.suggestions.length > 0) {
          console.log(
            yellow(`Did you mean: ${event.suggestions.map((s) => `/${s}`).join(", ")}?\n`),
          );
        }
        break;
      case "open-url": {
        const openCmd =
          process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "start"
              : "xdg-open";
        exec(`${openCmd} ${event.url}`);
        break;
      }
      case "exit":
        return true;
    }
    return false;
  }

  // --- Welcome message ---
  const allCommands = BoxREPLClient.suggestCommands("");
  console.log(`\nConnected to box ${box.id}`);
  console.log(
    `Type a prompt to run the agent, or use commands: ${allCommands.map((c) => `/${c.name}`).join(", ")}, /exit\n`,
  );

  // --- Main REPL loop ---
  try {
    while (true) {
      clearPreview();
      const suggestion = nextSuggestion;
      nextSuggestion = null;

      const answer = await rl.question(prompt).then((input) => {
        // Rewrite the prompt line with the input in green
        if (input.trim()) {
          stdout.write(`\x1b[A\r${eraseLine}${prompt}${green(input)}\n`);
        }
        return input;
      });

      if (suggestion && stdin.isTTY) {
        setImmediate(() => showGhost(suggestion));
      }

      let shouldExit = false;
      try {
        for await (const event of client.handleInput(answer)) {
          if (processEvent(event)) {
            shouldExit = true;
            break;
          }
        }
      } catch (err) {
        ensureSpinnerStopped();
        console.error(red(`Error: ${err instanceof Error ? err.message : err}`));
      }

      if (shouldExit) break;
    }
  } finally {
    clearPreview();
    rl.close();
  }
}
