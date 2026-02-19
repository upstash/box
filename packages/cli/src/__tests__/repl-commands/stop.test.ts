import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleStop } from "../../repl-commands/stop.js";

describe("handleStop", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("stops the box and returns true", async () => {
    const mockBox = {
      id: "box-1",
      stop: vi.fn().mockResolvedValue(undefined),
    };

    const result = await handleStop(mockBox as any, "");

    expect(mockBox.stop).toHaveBeenCalled();
    expect(result).toBe(true);
    expect(logSpy).toHaveBeenCalledWith("Box box-1 stopped.");
  });
});
