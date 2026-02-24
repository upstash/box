// ANSI escape helpers — thin wrappers, no dependencies.

export const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;
export const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
export const cyan = (s: string) => `\x1b[36m${s}\x1b[39m`;
export const green = (s: string) => `\x1b[32m${s}\x1b[39m`;
export const red = (s: string) => `\x1b[31m${s}\x1b[39m`;
export const yellow = (s: string) => `\x1b[33m${s}\x1b[39m`;
export const magenta = (s: string) => `\x1b[35m${s}\x1b[39m`;
export const gray = (s: string) => `\x1b[90m${s}\x1b[39m`;

// Cursor helpers
export const cursorUp = (n = 1) => `\x1b[${n}A`;
export const cursorDown = (n = 1) => `\x1b[${n}B`;
export const cursorSave = "\x1b[s";
export const cursorRestore = "\x1b[u";
export const eraseLine = "\x1b[2K";
export const eraseDown = "\x1b[J";
export const cursorHide = "\x1b[?25l";
export const cursorShow = "\x1b[?25h";

/** Strip all ANSI escape sequences from a string. */
export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}
