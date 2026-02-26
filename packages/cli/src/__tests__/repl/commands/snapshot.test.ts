import { describe, it, expect, vi } from "vitest";
import { handleSnapshot } from "../../../repl/commands/snapshot.js";
import { collectEvents } from "../helpers.js";

describe("handleSnapshot", () => {
  it("creates snapshot with custom name", async () => {
    const mockBox = {
      snapshot: vi.fn().mockResolvedValue({ id: "snap-1", name: "my-snap" }),
    };

    const events = await collectEvents(handleSnapshot(mockBox as any, "my-snap"));

    expect(mockBox.snapshot).toHaveBeenCalledWith({ name: "my-snap" });
    expect(events).toContainEqual(
      expect.objectContaining({ type: "log", message: expect.stringContaining("snap-1") }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "log", message: expect.stringContaining("my-snap") }),
    );
  });

  it("creates snapshot with default name when empty", async () => {
    const mockBox = {
      snapshot: vi.fn().mockResolvedValue({ id: "snap-2", name: "snapshot-1700000000" }),
    };

    await collectEvents(handleSnapshot(mockBox as any, ""));

    const call = mockBox.snapshot.mock.calls[0]![0];
    expect(call.name).toMatch(/^snapshot-\d+$/);
  });
});
