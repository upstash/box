import { stdin, stdout } from "node:process";
import { bold, cyan, dim, cursorHide, cursorShow, cursorUp, eraseLine } from "./ansi.js";

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

    function render(initial = false) {
      // Move up to overwrite previous render (skip on first draw)
      if (!initial) {
        stdout.write(cursorUp(visible) + eraseLine);
      }

      const start = Math.max(0, Math.min(cursor - visible + 1, items.length - visible));
      for (let i = start; i < start + visible; i++) {
        const item = items[i]!;
        const prefix = i === cursor ? cyan("> ") : "  ";
        const label = i === cursor ? bold(item.label) : item.label;
        const desc = item.description ? dim(` ${item.description}`) : "";
        stdout.write(`${eraseLine}${prefix}${label}${desc}\n`);
      }
    }

    stdout.write(cursorHide);
    stdout.write(`${prompt}\n`);
    render(true);

    if (!stdin.isTTY) {
      stdout.write(cursorShow);
      resolve(items[0]?.value);
      return;
    }

    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();

    function cleanup() {
      stdin.setRawMode(wasRaw);
      stdin.removeListener("data", onKey);
      stdin.pause();
      stdout.write(cursorShow);
    }

    function onKey(data: Buffer) {
      const key = data.toString();

      // Escape
      if (key === "\x1b" || key === "\x03") {
        cleanup();
        resolve(undefined);
        return;
      }

      // Enter
      if (key === "\r" || key === "\n") {
        cleanup();
        resolve(items[cursor]?.value);
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
