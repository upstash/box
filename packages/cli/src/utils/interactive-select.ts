import { stdin, stdout } from "node:process";
import { bold, cyan, dim, cursorHide, cursorShow, cursorUp, eraseLine, eraseDown } from "./ansi.js";

export interface SelectItem<T> {
  label: string;
  value: T;
  description?: string;
}

export interface SelectOptions<T> {
  items: SelectItem<T>[];
  prompt: string;
  pageSize?: number;
}

/**
 * Interactive arrow-key selector.
 * Resolves with the selected value, or undefined if the user presses Escape.
 */
export function interactiveSelect<T>(opts: SelectOptions<T>): Promise<T | undefined> {
  const { items, prompt, pageSize = 10 } = opts;
  if (items.length === 0) return Promise.resolve(undefined);

  return new Promise((resolve) => {
    let cursor = 0;
    const visible = Math.min(items.length, pageSize);

    // Track how many lines we've rendered so we can erase them on exit.
    // Layout: \n  prompt\n  \n  <visible items>\n  = 3 + visible lines below start.
    const headerLines = 3; // blank + prompt + blank

    function render(initial = false) {
      if (!initial) {
        stdout.write(cursorUp(visible));
      }

      const start = Math.max(0, Math.min(cursor - visible + 1, items.length - visible));
      for (let i = start; i < start + visible; i++) {
        const item = items[i]!;
        const prefix = i === cursor ? cyan("> ") : "  ";
        const label = i === cursor ? bold(item.label) : item.label;
        const desc = item.description ? dim(` ${item.description}`) : "";
        stdout.write(`\r${eraseLine}${prefix}${label}${desc}\n`);
      }
      // Clear any leftover content below the visible window
      stdout.write(eraseDown);
    }

    stdout.write(cursorHide);
    stdout.write(`\n${prompt}\n\n`);
    render(true);

    if (!stdin.isTTY) {
      stdout.write(cursorShow);
      resolve(items[0]?.value);
      return;
    }

    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();

    function finish(value: T | undefined) {
      stdin.removeListener("data", onKey);
      stdin.setRawMode(wasRaw);

      // Erase all rendered output (items + header) and restore cursor
      stdout.write(cursorUp(headerLines + visible - 1) + "\r" + eraseDown);
      stdout.write(cursorShow);

      resolve(value);
    }

    function onKey(data: Buffer) {
      const key = data.toString();

      // Escape / Ctrl+C
      if (key === "\x1b" || key === "\x03") {
        finish(undefined);
        return;
      }

      // Enter
      if (key === "\r" || key === "\n") {
        finish(items[cursor]?.value);
        return;
      }

      // Arrow up / k
      if (key === "\x1b[A" || key === "k") {
        cursor = Math.max(0, cursor - 1);
        render();
        return;
      }

      // Arrow down / j
      if (key === "\x1b[B" || key === "j") {
        cursor = Math.min(items.length - 1, cursor + 1);
        render();
        return;
      }
    }

    stdin.on("data", onKey);
  });
}
