import type { Box } from "@upstash/box";
import type { BoxREPLEvent, TodoItem, ToolCallSummary } from "../types.js";

/**
 * Derive a human-readable one-liner from a tool call's name and input.
 */
export function getToolSummary(toolName: string, input: Record<string, unknown>): ToolCallSummary {
  let summary: string;
  let detail: string | undefined;

  switch (toolName) {
    case "Bash": {
      const command = typeof input.command === "string" ? input.command : "";
      const truncatedCmd = command.length > 60 ? command.slice(0, 57) + "..." : command;
      summary = typeof input.description === "string" ? input.description : truncatedCmd;
      // Always include the command as detail when a description is present
      if (typeof input.description === "string" && command) {
        detail = truncatedCmd;
      }
      break;
    }
    case "Read":
    case "Edit":
    case "Write": {
      const filePath = typeof input.file_path === "string" ? input.file_path : "";
      summary = filePath.split("/").pop() || filePath;
      break;
    }
    case "Grep":
    case "Glob":
      summary = typeof input.pattern === "string" ? input.pattern : "";
      break;
    case "EnterPlanMode":
      summary = "Planning implementation";
      break;
    default: {
      const raw = JSON.stringify(input);
      summary = raw.length > 60 ? raw.slice(0, 57) + "..." : raw;
      break;
    }
  }

  return { name: toolName, summary, detail };
}

const VALID_TODO_STATUSES = new Set(["pending", "in_progress", "completed"]);

/**
 * Parse and validate todo items from a TodoWrite tool call input.
 */
export function parseTodoItems(input: Record<string, unknown>): TodoItem[] {
  if (!Array.isArray(input.todos)) return [];

  return input.todos.map((item: unknown): TodoItem => {
    const obj = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return {
      content: typeof obj.content === "string" ? obj.content : "",
      status:
        typeof obj.status === "string" && VALID_TODO_STATUSES.has(obj.status)
          ? (obj.status as TodoItem["status"])
          : "pending",
      activeForm: typeof obj.activeForm === "string" ? obj.activeForm : undefined,
    };
  });
}

/**
 * Run the agent with a prompt, streaming output as events.
 */
export async function* handleRun(box: Box, prompt: string): AsyncGenerator<BoxREPLEvent> {
  if (!prompt) {
    yield { type: "log", message: "Usage: run <prompt>" };
    return;
  }
  for await (const chunk of box.agent.stream({ prompt })) {
    if (chunk.type === "text-delta") {
      yield { type: "stream", text: chunk.text };
    } else if (chunk.type === "tool-call") {
      if (chunk.toolName === "TodoWrite") {
        const todos = parseTodoItems(chunk.input);
        yield { type: "todo", todos };
      } else {
        const tool = getToolSummary(chunk.toolName, chunk.input);
        yield { type: "tool", tool };
      }
    }
  }
  yield { type: "stream", text: "\n" };
}
