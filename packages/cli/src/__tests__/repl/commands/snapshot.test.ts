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

  describe("list", () => {
    it("prints each snapshot with its state", async () => {
      const box = {
        listSnapshots: vi
          .fn()
          .mockResolvedValue([{ id: "snap-1", name: "before", status: "ready", size_bytes: 1024 }]),
      };
      const events = await collectEvents(handleSnapshot(box as any, "list"));
      expect(box.listSnapshots).toHaveBeenCalled();
      expect(String(events[0]?.message)).toContain("snap-1");
      expect(String(events[0]?.message)).toContain("ready");
    });

    it("says so when there are none", async () => {
      const box = { listSnapshots: vi.fn().mockResolvedValue([]) };
      const events = await collectEvents(handleSnapshot(box as any, "list"));
      expect(events[0]).toEqual({ type: "log", message: "No snapshots." });
    });
  });

  describe("delete", () => {
    it("deletes by id", async () => {
      const box = { deleteSnapshot: vi.fn().mockResolvedValue(undefined) };
      await collectEvents(handleSnapshot(box as any, "delete snap-1"));
      expect(box.deleteSnapshot).toHaveBeenCalledWith("snap-1");
    });

    it("prints usage without an id", async () => {
      const box = { deleteSnapshot: vi.fn() };
      const events = await collectEvents(handleSnapshot(box as any, "delete"));
      expect(String(events[0]?.message)).toContain("Usage: snapshot delete");
      expect(box.deleteSnapshot).not.toHaveBeenCalled();
    });
  });

  it("still creates a snapshot with no subcommand", async () => {
    // The bare form predates the subcommands and must keep working.
    const box = { snapshot: vi.fn().mockResolvedValue({ id: "snap-9", name: "auto" }) };
    const events = await collectEvents(handleSnapshot(box as any, ""));
    expect(box.snapshot).toHaveBeenCalled();
    expect(String(events[0]?.message)).toContain("Snapshot created");
  });
});
