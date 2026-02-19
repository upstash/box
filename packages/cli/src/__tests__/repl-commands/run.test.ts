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

  it("runs agent and prints cost", async () => {
    const mockRun = {
      id: "run-1",
      cost: vi.fn().mockResolvedValue({ tokens: 500, computeMs: 3000, totalUsd: 0.01 }),
    };
    const mockBox = {
      agent: {
        run: vi.fn().mockResolvedValue(mockRun),
      },
    };

    await handleRun(mockBox as any, "fix the bug");

    expect(mockBox.agent.run).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "fix the bug" }),
    );
    // onStream callback should write chunks
    const onStream = mockBox.agent.run.mock.calls[0]![0].onStream;
    onStream("chunk1");
    expect(writeSpy).toHaveBeenCalledWith("chunk1");

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("500 tokens"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("3.0s"));
  });

  it("prints usage when no prompt", async () => {
    await handleRun({} as any, "");
    expect(logSpy).toHaveBeenCalledWith("Usage: run <prompt>");
  });
});
