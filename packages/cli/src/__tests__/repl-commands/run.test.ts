import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleRun } from "../../repl-commands/run.js";

describe("handleRun", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => vi.restoreAllMocks());

  it("streams agent output to stdout", async () => {
    async function* fakeStream() {
      yield "chunk1";
      yield "chunk2";
    }

    const mockBox = {
      agent: {
        stream: vi.fn().mockReturnValue(fakeStream()),
      },
    };

    await handleRun(mockBox as any, "fix the bug");

    expect(mockBox.agent.stream).toHaveBeenCalledWith({ prompt: "fix the bug" });
    expect(writeSpy).toHaveBeenCalledWith("chunk1");
    expect(writeSpy).toHaveBeenCalledWith("chunk2");
    // Trailing newline
    expect(logSpy).toHaveBeenCalled();
  });

  it("prints usage when no prompt", async () => {
    await handleRun({} as any, "");
    expect(logSpy).toHaveBeenCalledWith("Usage: run <prompt>");
  });
});
