import { describe, it, expect, vi } from "vitest";
import { handleRun } from "../../../repl/commands/run.js";
import type { REPLHooks } from "../../../repl/client.js";
import { Chunk } from "@upstash/box";

function createHooks() {
  return {
    onLog: vi.fn() as unknown as REPLHooks["onLog"],
    onError: vi.fn() as unknown as REPLHooks["onError"],
    onStream: vi.fn() as unknown as REPLHooks["onStream"],
  };
}

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
    const hooks = createHooks();

    await handleRun(mockBox as any, "fix the bug", hooks);

    expect(mockBox.agent.stream).toHaveBeenCalledWith({ prompt: "fix the bug" });
    expect(hooks.onStream).toHaveBeenCalledWith("chunk1");
    expect(hooks.onStream).toHaveBeenCalledWith("chunk2");
    // Trailing newline
    expect(hooks.onStream).toHaveBeenCalledWith("\n");
  });

  it("prints usage when no prompt", async () => {
    const hooks = createHooks();
    await handleRun({} as any, "", hooks);
    expect(hooks.onLog).toHaveBeenCalledWith("Usage: run <prompt>");
  });
});
