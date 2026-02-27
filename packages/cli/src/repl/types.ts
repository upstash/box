import type { Box } from "@upstash/box";

export type BoxREPLCommandName =
  | "run"
  | "exec"
  | "files"
  | "git"
  | "snapshot"
  | "pause"
  | "delete"
  | "console"
  | "clear"
  | "help";

/** Known tool names from the agent stream */
export type AgentToolName =
  | "Bash"
  | "Read"
  | "Edit"
  | "Write"
  | "Grep"
  | "Glob"
  | "TodoWrite"
  | "EnterPlanMode";

/** A single todo item from a TodoWrite tool call */
export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm?: string;
}

/** Summary of a tool invocation for display */
export interface ToolCallSummary {
  /** Tool name, typed for known tools with fallback */
  name: AgentToolName | (string & {});
  /** Human-readable one-liner derived from the tool's key input */
  summary: string;
  /** Optional secondary detail (e.g. the raw command for Bash) */
  detail?: string;
}

export type BoxREPLEvent =
  | { type: "log"; message: string }
  | { type: "error"; message: string }
  | { type: "stream"; text: string }
  | { type: "tool"; tool: ToolCallSummary }
  | { type: "todo"; todos: TodoItem[] }
  | { type: "command:start"; command: BoxREPLCommandName; args: string }
  | { type: "command:complete"; command: BoxREPLCommandName; durationMs: number }
  | { type: "command:not-found"; typed: string; suggestions: BoxREPLCommandName[] }
  | { type: "suggestion"; text: string }
  | { type: "clear" }
  | { type: "open-url"; url: string }
  | { type: "exit"; message: string };

export type BoxREPLCommandHandler = (box: Box, args: string) => AsyncGenerator<BoxREPLEvent>;

export interface BoxREPLCommand {
  name: BoxREPLCommandName;
  description: string;
  handler: BoxREPLCommandHandler;
}
