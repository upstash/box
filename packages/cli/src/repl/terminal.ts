import { exec } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import type { Box } from "@upstash/box";
import type { BoxREPLEvent } from "./types.js";
import { BoxREPLClient, type BoxREPLClientOptions } from "./client.js";
import { startSpinner } from "./spinner.js";
import {
  bold,
  cyan,
  dim,
  gray,
  green,
  red,
  yellow,
  cursorUp,
  eraseDown,
  stripAnsi,
} from "../utils/ansi.js";

/**
 * Start an interactive REPL session for the given box (CLI entry point).
 */
export async function startRepl(box: Box, options?: BoxREPLClientOptions): Promise<void> {
  const rl = createInterface({
    input: stdin,
    output: stdout,
    completer: (): [string[], string] => [[], ""],
  });

  const getPrompt = () => {
    const { label, cwd } = client.promptInfo;
    return `${bold(cyan(label))}${dim(":")}${gray(cwd)}${dim(">")} `;
  };

  const client = new BoxREPLClient(box, options);
  client.refreshCwdEntries();
  let currentPrompt = getPrompt();

  // --- Spinner tracking ---
  let activeSpinnerStop: (() => void) | null = null;
  let inCommand = false;

  // --- Todo checklist tracking ---
  let todoLines = 0;

  // --- Stream newline tracking ---
  let needsNewline = false;

  function ensureSpinnerStopped() {
    if (activeSpinnerStop) {
      activeSpinnerStop();
      activeSpinnerStop = null;
    }
  }

  function ensureNewline() {
    if (needsNewline) {
      stdout.write("\n");
      needsNewline = false;
    }
  }

  function restartSpinnerIfInCommand() {
    if (inCommand) {
      activeSpinnerStop = startSpinner();
    }
  }

  // --- Command preview while typing ---
  let previewLines = 0;
  let promptVisualLen = stripAnsi(currentPrompt).length;

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
  let ghostText: string | null = null;

  function showGhost(text: string) {
    ghostText = text;
    stdout.write(dim(text));
    // Move cursor back to just after the prompt
    stdout.write(`\x1b[${text.length}D`);
  }

  // --- Tab file-completion state ---
  let tabCompletions: string[] | null = null;
  let tabIndex = -1;
  let tabOriginalLine = "";
  let tabPreviewLines = 0;

  function clearTabPreview() {
    if (tabPreviewLines > 0) {
      stdout.write("\n" + eraseDown + cursorUp(1));
      restoreCursorColumn();
      tabPreviewLines = 0;
    }
  }

  function resetTabState() {
    if (tabCompletions !== null) {
      clearTabPreview();
      tabCompletions = null;
      tabIndex = -1;
      tabOriginalLine = "";
    }
  }

  // --- Multi-line input tracking ---
  let isMetaReturn = false;

  if (stdin.isTTY) {
    // Must run before readline's handler so the cursor is still on the input line
    stdin.prependListener(
      "keypress",
      (_str: string, key: { name?: string; meta?: boolean; shift?: boolean }) => {
        if (key?.name === "return") {
          clearPreview();
          resetTabState();
          if (key.meta || key.shift) {
            isMetaReturn = true;
          }
        }
      },
    );

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

      // --- Tab file completion ---
      if (key?.name === "tab") {
        setImmediate(() => {
          const line = (rl as unknown as { line: string }).line ?? "";
          const rlAny = rl as unknown as { line: string; cursor: number };

          if (tabCompletions === null) {
            // First Tab press — compute matches
            const lastSpace = line.lastIndexOf(" ");
            const partial = lastSpace === -1 ? line : line.slice(lastSpace + 1);
            const matches = client.getCompletions(partial);

            if (matches.length === 0) return;

            if (matches.length === 1) {
              // Single match — insert remaining suffix
              const suffix = matches[0]!.slice(partial.length);
              if (suffix) rl.write(suffix);
              return;
            }

            // Multiple matches — save state, insert first match
            tabOriginalLine = line;
            tabCompletions = matches;
            tabIndex = 0;

            const suffix = matches[0]!.slice(partial.length);
            if (suffix) rl.write(suffix);

            // Show all matches below prompt
            clearTabPreview();
            const display = matches.join("  ");
            stdout.write("\n" + dim(display) + cursorUp(1));
            restoreCursorColumn();
            tabPreviewLines = 1;
          } else {
            // Subsequent Tab — cycle to next match
            tabIndex = (tabIndex + 1) % tabCompletions.length;
            const lastSpace = tabOriginalLine.lastIndexOf(" ");
            const prefix = lastSpace === -1 ? "" : tabOriginalLine.slice(0, lastSpace + 1);
            const newLine = prefix + tabCompletions[tabIndex]!;

            // Erase current line on screen, then set readline internals directly
            stdout.write(
              "\r" + currentPrompt + " ".repeat(rlAny.line.length) + "\r" + currentPrompt,
            );
            rlAny.line = newLine;
            rlAny.cursor = newLine.length;
            stdout.write(newLine);
          }
        });
        return;
      }

      // Any non-Tab key resets tab state
      if (tabCompletions !== null) {
        resetTabState();
      }

      // Command preview logic (deferred so rl.line is up to date)
      setImmediate(() => {
        const line = (rl as unknown as { line: string }).line ?? "";
        clearPreview();

        if (line.startsWith("/") && !line.includes(" ")) {
          const partial = line.slice(1);
          const matches = client.suggestCommands(partial).slice(0, 5);
          if (matches.length > 0) {
            const termWidth = stdout.columns || 80;
            let visualRows = 0;
            const preview = matches
              .map((c) => {
                const plain = `  /${c.name} — ${c.description}`;
                visualRows += Math.ceil(plain.length / termWidth) || 1;
                return `  ${dim(`/${c.name}`)} ${dim("—")} ${dim(c.description)}`;
              })
              .join("\n");
            stdout.write("\n" + preview + cursorUp(visualRows));
            restoreCursorColumn();
            previewLines = visualRows;
          }
        }
      });
    });
  }

  /** Map a single event to terminal actions. Returns true if the loop should exit. */
  function processEvent(event: BoxREPLEvent): boolean {
    switch (event.type) {
      case "command:start":
        inCommand = true;
        stdout.write("\n");
        activeSpinnerStop = startSpinner();
        break;
      case "log":
        ensureSpinnerStopped();
        ensureNewline();
        clearPreview();
        console.log(event.message);
        needsNewline = false;
        todoLines = 0;
        restartSpinnerIfInCommand();
        break;
      case "error":
        ensureSpinnerStopped();
        ensureNewline();
        clearPreview();
        console.error(red(event.message));
        needsNewline = false;
        todoLines = 0;
        restartSpinnerIfInCommand();
        break;
      case "stream":
        ensureSpinnerStopped();
        process.stdout.write(event.text);
        needsNewline = !event.text.endsWith("\n");
        todoLines = 0;
        break;
      case "tool": {
        ensureSpinnerStopped();
        ensureNewline();
        const { name, summary, detail } = event.tool;
        if (name === "Bash") {
          let line = dim("  ⚡ ") + yellow(name) + dim(": " + summary);
          if (detail) {
            line += dim("\n      $ " + detail);
          }
          console.log(line);
        } else {
          console.log(dim("  ⚡ ") + yellow(name) + dim("(" + summary + ")"));
        }
        needsNewline = false;
        todoLines = 0;
        restartSpinnerIfInCommand();
        break;
      }
      case "todo": {
        ensureSpinnerStopped();
        ensureNewline();
        if (todoLines > 0) {
          stdout.write(cursorUp(todoLines) + eraseDown);
        }
        for (const item of event.todos) {
          if (item.status === "completed") {
            console.log(green("  ✔") + " " + item.content);
          } else if (item.status === "in_progress") {
            console.log(cyan("  ◼") + " " + item.content);
          } else {
            console.log(dim("  ◻ " + item.content));
          }
        }
        stdout.write("\n"); // bottom margin
        todoLines = event.todos.length + 1; // items + bottom margin
        needsNewline = false;
        restartSpinnerIfInCommand();
        break;
      }
      case "command:complete": {
        inCommand = false;
        ensureSpinnerStopped();
        ensureNewline();
        todoLines = 0;
        needsNewline = false;
        const seconds = (event.durationMs / 1000).toFixed(1);
        console.log(dim(`\n  /${event.command} completed in ${seconds}s\n`));
        break;
      }
      case "command:not-found":
        ensureNewline();
        console.error(yellow(`\nUnknown command: /${event.typed}`));
        if (event.suggestions.length > 0) {
          console.log(
            yellow(`Did you mean: ${event.suggestions.map((s) => `/${s}`).join(", ")}?\n`),
          );
        }
        break;
      case "clear":
        stdout.write("\x1b[2J\x1b[H");
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
  const allCommands = client.suggestCommands("");
  console.log(`\nConnected to box ${box.id}`);
  console.log(
    `Type a command to run in the box, or use: ${allCommands.map((c) => `/${c.name}`).join(", ")}\n`,
  );

  // --- Main REPL loop ---
  try {
    while (true) {
      clearPreview();
      currentPrompt = getPrompt();
      promptVisualLen = stripAnsi(currentPrompt).length;
      const continuationPrompt = " ".repeat(promptVisualLen);
      // Collect input (supports multi-line via alt+enter / shift+enter)
      const inputLines: string[] = [];
      isMetaReturn = false;

      // Show ghost suggestion from previous command once the prompt renders
      const suggestion = client.suggestion;
      if (suggestion && stdin.isTTY) {
        setImmediate(() => showGhost(suggestion));
      }

      let firstLine: string;
      try {
        firstLine = await rl.question(currentPrompt);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") break;
        throw err;
      }
      inputLines.push(firstLine);

      if (isMetaReturn && stdin.isTTY) {
        while (true) {
          isMetaReturn = false;
          try {
            const nextLine = await rl.question(continuationPrompt);
            inputLines.push(nextLine);
          } catch (err) {
            if (err instanceof Error && err.name === "AbortError") break;
            throw err;
          }
          if (!isMetaReturn) break;
        }
      }

      const answer = inputLines.join("\n");

      // Rewrite all input lines in green
      if (answer.trim()) {
        const termWidth = stdout.columns || 80;
        let totalVisualRows = 0;
        for (const line of inputLines) {
          const totalChars = promptVisualLen + line.length;
          totalVisualRows += Math.ceil(totalChars / termWidth) || 1;
        }
        stdout.write(cursorUp(totalVisualRows) + "\r" + eraseDown);
        for (let i = 0; i < inputLines.length; i++) {
          const p = i === 0 ? currentPrompt : continuationPrompt;
          stdout.write(p + green(inputLines[i]!) + "\n");
        }
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
        console.error(red(`Error: ${err instanceof Error ? err.message : err}`));
      }

      // Always clean up after event processing — handles cases where the
      // generator ends without a command:complete (e.g. after an error event).
      inCommand = false;
      ensureSpinnerStopped();

      if (shouldExit) break;
    }
  } finally {
    clearPreview();
    rl.close();
  }
}
