import { describe, it, expect, vi } from "vitest";
import { handleRun } from "../../../repl/commands/run.js";
import { Chunk } from "@upstash/box";
import { collectEvents } from "../helpers.js";

describe("handleRun", () => {
  it("streams agent output to stdout", async () => {
    async function* fakeStream(): AsyncGenerator<Chunk> {
      yield { type: "text-delta", text: "chunk1" };
      yield { type: "text-delta", text: "chunk2" };
    }

    const mockBox = {
      agent: {
        stream: vi.fn().mockReturnValue(fakeStream()),
      },
    };

    const events = await collectEvents(handleRun(mockBox as any, "fix the bug"));

    expect(mockBox.agent.stream).toHaveBeenCalledWith({ prompt: "fix the bug" });
    expect(events).toContainEqual({ type: "stream", text: "chunk1" });
    expect(events).toContainEqual({ type: "stream", text: "chunk2" });
    // Trailing newline
    expect(events).toContainEqual({ type: "stream", text: "\n" });
  });

  it("prints usage when no prompt", async () => {
    const events = await collectEvents(handleRun({} as any, ""));
    expect(events).toContainEqual({ type: "log", message: "Usage: run <prompt>" });
  });
});
