import { describe, it, expect, vi } from "vitest";
import { handleRun } from "../../../repl/commands/run.js";
import { collectEvents } from "../helpers.js";

/**
 * Helper: creates a mock box whose agent.stream() returns a StreamRun-like
 * async iterable that yields Chunk objects.
 */
function createMockBox(chunks: Array<{ type: string; [key: string]: any }>) {
  return {
    agent: {
      stream: vi.fn().mockImplementation(async () => {
        async function* iterate() {
          for (const chunk of chunks) {
            yield chunk;
          }
        }
        return { [Symbol.asyncIterator]: () => iterate() };
      }),
    },
  };
}

describe("handleRun", () => {
  it("streams agent text output", async () => {
    const mockBox = createMockBox([
      { type: "text-delta", text: "chunk1" },
      { type: "text-delta", text: "chunk2" },
    ]);

    const events = await collectEvents(handleRun(mockBox as any, "fix the bug"));

    expect(mockBox.agent.stream).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "fix the bug" }),
    );
    expect(events).toContainEqual({ type: "stream", text: "chunk1" });
    expect(events).toContainEqual({ type: "stream", text: "chunk2" });
    // Trailing newline
    expect(events).toContainEqual({ type: "stream", text: "\n" });
  });

  it("prints usage when no prompt", async () => {
    const events = await collectEvents(handleRun({} as any, ""));
    expect(events).toContainEqual({ type: "log", message: "Usage: run <prompt>" });
  });

  it("yields tool event for Bash with description and command detail", async () => {
    const mockBox = createMockBox([
      {
        type: "tool-call",
        toolName: "Bash",
        input: { command: "npm install", description: "Install dependencies" },
      },
    ]);

    const events = await collectEvents(handleRun(mockBox as any, "setup project"));

    expect(events).toContainEqual({
      type: "tool",
      tool: { name: "Bash", summary: "Install dependencies", detail: "npm install" },
    });
  });

  it("yields tool event for Read tool-call with basename", async () => {
    const mockBox = createMockBox([
      {
        type: "tool-call",
        toolName: "Read",
        input: { file_path: "/Users/dev/project/config.ts" },
      },
    ]);

    const events = await collectEvents(handleRun(mockBox as any, "read config"));

    expect(events).toContainEqual({
      type: "tool",
      tool: { name: "Read", summary: "config.ts", detail: undefined },
    });
  });

  it("yields todo event for TodoWrite tool-call", async () => {
    const mockBox = createMockBox([
      {
        type: "tool-call",
        toolName: "TodoWrite",
        input: {
          todos: [
            { content: "Fix the bug", status: "in_progress" },
            { content: "Write tests", status: "pending" },
            { content: "Deploy", status: "completed" },
          ],
        },
      },
    ]);

    const events = await collectEvents(handleRun(mockBox as any, "plan work"));

    const todoEvent = events.find((e) => e.type === "todo");
    expect(todoEvent).toBeDefined();
    expect(todoEvent).toEqual({
      type: "todo",
      todos: [
        { content: "Fix the bug", status: "in_progress", activeForm: undefined },
        { content: "Write tests", status: "pending", activeForm: undefined },
        { content: "Deploy", status: "completed", activeForm: undefined },
      ],
    });
  });

  it("yields tool event for unknown tool name", async () => {
    const mockBox = createMockBox([
      {
        type: "tool-call",
        toolName: "CustomTool",
        input: { foo: "bar" },
      },
    ]);

    const events = await collectEvents(handleRun(mockBox as any, "do something"));

    expect(events).toContainEqual({
      type: "tool",
      tool: { name: "CustomTool", summary: '{"foo":"bar"}', detail: undefined },
    });
  });

  it("yields Bash tool with truncated command when no description", async () => {
    const longCommand = "a".repeat(80);
    const mockBox = createMockBox([
      {
        type: "tool-call",
        toolName: "Bash",
        input: { command: longCommand },
      },
    ]);

    const events = await collectEvents(handleRun(mockBox as any, "run long cmd"));

    const toolEvent = events.find((e) => e.type === "tool");
    expect(toolEvent).toBeDefined();
    if (toolEvent && toolEvent.type === "tool") {
      expect(toolEvent.tool.name).toBe("Bash");
      expect(toolEvent.tool.summary).toBe("a".repeat(57) + "...");
      expect(toolEvent.tool.summary.length).toBe(60);
      // No detail when there's no description (summary IS the command)
      expect(toolEvent.tool.detail).toBeUndefined();
    }
  });

  it("yields Grep tool event with pattern summary", async () => {
    const mockBox = createMockBox([
      {
        type: "tool-call",
        toolName: "Grep",
        input: { pattern: "TODO|FIXME", path: "/src" },
      },
    ]);

    const events = await collectEvents(handleRun(mockBox as any, "find todos"));

    expect(events).toContainEqual({
      type: "tool",
      tool: { name: "Grep", summary: "TODO|FIXME", detail: undefined },
    });
  });

  it("defaults invalid todo status to pending", async () => {
    const mockBox = createMockBox([
      {
        type: "tool-call",
        toolName: "TodoWrite",
        input: {
          todos: [{ content: "Task", status: "invalid_status" }],
        },
      },
    ]);

    const events = await collectEvents(handleRun(mockBox as any, "plan"));

    const todoEvent = events.find((e) => e.type === "todo");
    expect(todoEvent).toBeDefined();
    if (todoEvent && todoEvent.type === "todo") {
      expect(todoEvent.todos[0].status).toBe("pending");
    }
  });

  it("yields tool event for EnterPlanMode", async () => {
    const mockBox = createMockBox([
      {
        type: "tool-call",
        toolName: "EnterPlanMode",
        input: {},
      },
    ]);

    const events = await collectEvents(handleRun(mockBox as any, "plan this"));

    expect(events).toContainEqual({
      type: "tool",
      tool: { name: "EnterPlanMode", summary: "Planning implementation", detail: undefined },
    });
  });

  it("ignores non-text non-tool chunks", async () => {
    const mockBox = createMockBox([
      { type: "start", runId: "r1" },
      { type: "text-delta", text: "hello" },
      { type: "reasoning", text: "thinking..." },
      {
        type: "finish",
        output: "hello",
        usage: { inputTokens: 1, outputTokens: 1 },
        sessionId: "s",
      },
    ]);

    const events = await collectEvents(handleRun(mockBox as any, "test"));

    const streamEvents = events.filter((e) => e.type === "stream");
    expect(streamEvents).toEqual([
      { type: "stream", text: "hello" },
      { type: "stream", text: "\n" },
    ]);
    // No tool or todo events
    expect(events.filter((e) => e.type === "tool" || e.type === "todo")).toEqual([]);
  });
});
