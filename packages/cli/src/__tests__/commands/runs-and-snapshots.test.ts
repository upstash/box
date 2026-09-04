import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { statusRunsCommand, statusLogsCommand, cancelCommand } from "../../commands/status.js";
import { snapshotListCommand, snapshotDeleteCommand } from "../../commands/snapshot.js";

const getBox = vi.hoisted(() => vi.fn());
vi.mock("@upstash/box", () => ({ Box: { get: getBox } }));

vi.mock("../../core/box-ref.js", () => ({
  resolveBoxId: vi.fn(() => ({ id: "b1", source: "flag" })),
  announceBox: vi.fn(),
  findBoxFile: vi.fn(() => undefined),
}));

describe("runs, logs, cancel and snapshots", () => {
  let stdout: ReturnType<typeof vi.spyOn>;
  const flags = { box: "b1", token: "box_test" };
  const written = () => stdout.mock.calls.map((c) => String(c[0])).join("");

  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    getBox.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  describe("status runs", () => {
    it("lists runs with the id first, since that is what cancel needs", async () => {
      getBox.mockResolvedValue({
        listRuns: vi.fn().mockResolvedValue([
          {
            id: "run-1",
            type: "agent",
            status: "completed",
            duration_ms: 4200,
            cost_usd: 0.0123,
          },
        ]),
      });

      await statusRunsCommand({ ...flags });

      expect(written()).toContain("run-1");
      expect(written()).toContain("agent");
    });

    it("says so plainly when there are none", async () => {
      getBox.mockResolvedValue({ listRuns: vi.fn().mockResolvedValue([]) });

      await statusRunsCommand({ ...flags });

      expect(written()).toMatch(/no runs/i);
    });

    it("emits the raw run objects under --json", async () => {
      const runs = [{ id: "run-1", type: "shell", duration_ms: 10, cost_usd: 0 }];
      getBox.mockResolvedValue({ listRuns: vi.fn().mockResolvedValue(runs) });

      await statusRunsCommand({ ...flags, json: true });

      expect(JSON.parse(written())).toEqual(runs);
    });
  });

  describe("status logs", () => {
    it("passes paging through only when asked", async () => {
      const logs = vi.fn().mockResolvedValue([]);
      getBox.mockResolvedValue({ logs });

      await statusLogsCommand({ ...flags });
      expect(logs).toHaveBeenCalledWith({});

      await statusLogsCommand({ ...flags, limit: "50", offset: "10" });
      expect(logs).toHaveBeenCalledWith({ limit: 50, offset: 10 });
    });

    it("renders the timestamp as a date rather than a number", async () => {
      getBox.mockResolvedValue({
        logs: vi
          .fn()
          .mockResolvedValue([
            { timestamp: 1767225600, level: "error", source: "agent", message: "boom" },
          ]),
      });

      await statusLogsCommand({ ...flags });

      expect(written()).toContain("boom");
      expect(written()).toMatch(/\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe("cancel", () => {
    it("cancels the run it was given", async () => {
      const cancelRun = vi.fn().mockResolvedValue(undefined);
      getBox.mockResolvedValue({ cancelRun });

      await cancelCommand("run-9", { ...flags });

      expect(cancelRun).toHaveBeenCalledWith("run-9");
      expect(written()).toContain("run-9");
    });
  });

  describe("snapshots", () => {
    it("lists snapshots id-first, so delete has something to take", async () => {
      getBox.mockResolvedValue({
        listSnapshots: vi
          .fn()
          .mockResolvedValue([
            { id: "snap-1", name: "before-migration", status: "ready", size_bytes: 52_428_800 },
          ]),
      });

      await snapshotListCommand({ ...flags });

      expect(written()).toContain("snap-1");
      expect(written()).toContain("50MB");
    });

    it("reports an empty list rather than printing nothing", async () => {
      getBox.mockResolvedValue({ listSnapshots: vi.fn().mockResolvedValue([]) });

      await snapshotListCommand({ ...flags });

      expect(written()).toMatch(/no snapshots/i);
    });

    it("deletes by id", async () => {
      const deleteSnapshot = vi.fn().mockResolvedValue(undefined);
      getBox.mockResolvedValue({ deleteSnapshot });

      await snapshotDeleteCommand("snap-2", { ...flags });

      expect(deleteSnapshot).toHaveBeenCalledWith("snap-2");
    });
  });
});
