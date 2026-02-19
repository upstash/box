import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleSnapshot } from "../../repl-commands/snapshot.js";

describe("handleSnapshot", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("creates snapshot with custom name", async () => {
    const mockBox = {
      snapshot: vi.fn().mockResolvedValue({ id: "snap-1", name: "my-snap" }),
    };

    await handleSnapshot(mockBox as any, "my-snap");

    expect(mockBox.snapshot).toHaveBeenCalledWith({ name: "my-snap" });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("snap-1"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("my-snap"));
  });

  it("creates snapshot with default name when empty", async () => {
    const mockBox = {
      snapshot: vi.fn().mockResolvedValue({ id: "snap-2", name: "snapshot-1700000000" }),
    };

    await handleSnapshot(mockBox as any, "");

    const call = mockBox.snapshot.mock.calls[0]![0];
    expect(call.name).toMatch(/^snapshot-\d+$/);
  });
});
