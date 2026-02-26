import type { Box } from "@upstash/box";

export type BoxREPLCommandName =
  | "run"
  | "exec"
  | "files"
  | "git"
  | "snapshot"
  | "pause"
  | "delete"
  | "console";

export type BoxREPLEvent =
  | { type: "log"; message: string }
  | { type: "error"; message: string }
  | { type: "stream"; text: string }
  | { type: "command:start"; command: BoxREPLCommandName; args: string }
  | { type: "command:complete"; command: BoxREPLCommandName; durationMs: number }
  | { type: "command:not-found"; typed: string; suggestions: BoxREPLCommandName[] }
  | { type: "suggestion"; text: string }
  | { type: "open-url"; url: string }
  | { type: "exit"; message: string };

export type BoxREPLCommandHandler = (box: Box, args: string) => AsyncGenerator<BoxREPLEvent>;

export interface BoxREPLCommand {
  name: BoxREPLCommandName;
  description: string;
  handler: BoxREPLCommandHandler;
}
