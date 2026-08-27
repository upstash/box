import { describe, it, expect, vi } from "vitest";
import { handleStatus } from "../../../repl/commands/status.js";
import { collectEvents } from "../helpers.js";

describe("handleStatus", () => {
  function createMockBox() {
    return {
      id: "box-1",
      getStatus: vi.fn().mockResolvedValue({ status: "idle" }),
      listRuns: vi.fn().mockResolvedValue([]),
      logs: vi.fn().mockResolvedValue([]),
    };
  }

  it("reports the box state", async () => {
    const events = await collectEvents(handleStatus(createMockBox() as any, ""));
    expect(events[0]).toEqual({ type: "log", message: "box-1 is idle" });
  });

  it("explains that a paused box wakes on the next command", async () => {
    const box = createMockBox();
    box.getStatus.mockResolvedValue({ status: "paused" });
    const events = await collectEvents(handleStatus(box as any, ""));
    expect(events.some((e) => String(e.message).includes("resumes automatically"))).toBe(true);
  });

  it("shows the newest runs, not the oldest", async () => {
    // listRuns comes back newest-first; taking the tail showed the ten oldest.
    const box = createMockBox();
    box.listRuns.mockResolvedValue(
      Array.from({ length: 12 }, (_unused, index) => ({ id: `run-${index}`, status: "completed" })),
    );
    const events = await collectEvents(handleStatus(box as any, "runs"));
    expect(String(events[0]?.message)).toContain("run-0");
    expect(events).toHaveLength(10);
    expect(events.some((e) => String(e.message).includes("run-11"))).toBe(false);
  });

  it("formats log timestamps as unix seconds", async () => {
    const box = createMockBox();
    box.logs.mockResolvedValue([
      { timestamp: 1_767_225_600, level: "info", source: "system", message: "Box ready." },
    ]);
    const events = await collectEvents(handleStatus(box as any, "logs 5"));
    expect(box.logs).toHaveBeenCalledWith({ limit: 5 });
    expect(String(events[0]?.message)).toContain("2026-01-01T");
    expect(String(events[0]?.message)).toContain("[info] system: Box ready.");
  });

  it("defaults the log limit", async () => {
    const box = createMockBox();
    await collectEvents(handleStatus(box as any, "logs"));
    expect(box.logs).toHaveBeenCalledWith({ limit: 20 });
  });
});
