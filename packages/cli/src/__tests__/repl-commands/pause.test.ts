import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handlePause } from "../../repl-commands/pause.js";

describe("handlePause", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("pauses the box and returns true", async () => {
    const mockBox = {
      id: "box-1",
      pause: vi.fn().mockResolvedValue(undefined),
    };

    const result = await handlePause(mockBox as any, "");

    expect(mockBox.pause).toHaveBeenCalled();
    expect(result).toBe(true);
    expect(logSpy).toHaveBeenCalledWith("Box box-1 paused.");
  });
});
