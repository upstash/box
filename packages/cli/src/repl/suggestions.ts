import type { BoxREPLCommandName } from "./types.js";

export type SuggestionContext =
  | { kind: "command"; command: BoxREPLCommandName }
  | { kind: "agent"; initial: boolean }
  | { kind: "shell"; input: string };

/** Predefined follow-up suggestions for slash commands. */
const COMMAND_SUGGESTIONS: Partial<Record<BoxREPLCommandName, string[]>> = {
  files: ["ls", "cat README.md", "/git status"],
  git: ["/snapshot", "/files list .", "ls"],
  snapshot: ["/pause", "/console", "/git status"],
  cd: ["ls", "pwd", "tree"],
  console: ["/snapshot", "/git status"],
  pause: ["/delete"],
};

/** Predefined follow-up suggestions for shell commands (matched by first token). */
const SHELL_SUGGESTIONS: Record<string, string[]> = {
  ls: ["cat README.md", "pwd", "/files list ."],
  cat: ["ls", "/git diff", "pwd"],
  pwd: ["ls", "cd ..", "tree"],
  mkdir: ["ls", "cd"],
  touch: ["ls", "cat"],
  rm: ["ls", "pwd"],
  mv: ["ls", "pwd"],
  cp: ["ls", "pwd"],
  echo: ["ls", "cat"],
  tree: ["cd", "ls", "/files list ."],
  npm: ["ls", "/git status", "/snapshot"],
  node: ["ls", "/git status"],
  python: ["ls", "/git status"],
  pip: ["ls", "python"],
  git: ["/git status", "/snapshot", "ls"],
  curl: ["ls", "cat"],
  wget: ["ls", "cat"],
};

/** Fallback shell suggestions when no specific match exists. */
const DEFAULT_SHELL_SUGGESTIONS = ["ls", "pwd", "/help", "/git status", "/files list ."];

/** Fallback agent suggestions. */
const DEFAULT_AGENT_SUGGESTIONS = ["commit this change", "explain the changes", "/snapshot"];

const INITIAL_AGENT_SUGGESTIONS = [
  "explain this directory",
  "what files are here?",
  "summarize this project",
];

function pickRandom(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/** Context-aware suggestion after a command or input completes. */
export function getNextSuggestion(ctx: SuggestionContext): string {
  switch (ctx.kind) {
    case "command": {
      const pool = COMMAND_SUGGESTIONS[ctx.command];
      return pool ? pickRandom(pool) : pickRandom(DEFAULT_SHELL_SUGGESTIONS);
    }
    case "agent": {
      if (ctx.initial) return pickRandom(INITIAL_AGENT_SUGGESTIONS);
      return pickRandom(DEFAULT_AGENT_SUGGESTIONS);
    }
    case "shell": {
      const firstToken = ctx.input.split(/\s+/)[0]!;
      const pool = SHELL_SUGGESTIONS[firstToken];
      return pool ? pickRandom(pool) : pickRandom(DEFAULT_SHELL_SUGGESTIONS);
    }
  }
}
