import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CliError } from "../../core/errors.js";
import { snapshotCommand } from "../../commands/snapshot.js";

vi.mock("@upstash/box", () => ({
  Box: {
    get: vi.fn(),
    list: vi.fn(),
  },
}));

vi.mock("../../utils/interactive-select.js", () => ({
  interactiveSelect: vi.fn(),
}));

vi.mock("../../auth.js", () => ({
  resolveToken: vi.fn((token?: string) => token ?? "resolved-token"),
}));

import { Box } from "@upstash/box";

describe("snapshotCommand", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let stdout: ReturnType<typeof vi.spyOn>;
  const written = () => stdout.mock.calls.map((call) => String(call[0])).join("");
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("snapshots box by ID", async () => {
    const mockSnapshot = { id: "snap-1", name: "my-snap" };
    const mockBox = { id: "box-1", snapshot: vi.fn().mockResolvedValueOnce(mockSnapshot) };
    vi.mocked(Box.get).mockResolvedValueOnce(mockBox as any);

    await snapshotCommand("box-1", { token: "key", name: "my-snap" });

    expect(Box.get).toHaveBeenCalledWith("box-1", { apiKey: "key" });
    expect(mockBox.snapshot).toHaveBeenCalledWith({ name: "my-snap" });
    expect(written()).toContain("Snapshot created: snap-1 (my-snap)");
  });

  it("uses single box when only one exists", async () => {
    const mockSnapshot = { id: "snap-2", name: "auto" };
    const mockBox = { id: "box-only", snapshot: vi.fn().mockResolvedValueOnce(mockSnapshot) };
    vi.mocked(Box.list).mockResolvedValueOnce([{ id: "box-only", status: "idle" } as any]);
    vi.mocked(Box.get).mockResolvedValueOnce(mockBox as any);

    await snapshotCommand(undefined, { token: "key", name: "auto" });

    expect(logSpy).toHaveBeenCalledWith("Only one box found, using it...");
    expect(Box.get).toHaveBeenCalledWith("box-only", { apiKey: "key" });
  });

  it("exits when no boxes found", async () => {
    vi.mocked(Box.list).mockResolvedValueOnce([]);

    await expect(snapshotCommand(undefined, { token: "key" })).rejects.toThrow(/No boxes found/);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("filters out deleted boxes", async () => {
    vi.mocked(Box.list).mockResolvedValueOnce([{ id: "box-deleted", status: "deleted" } as any]);

    await expect(snapshotCommand(undefined, { token: "key" })).rejects.toThrow(/No boxes found/);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("generates default snapshot name when none provided", async () => {
    const mockSnapshot = { id: "snap-3", name: "snapshot-123" };
    const mockBox = { id: "box-1", snapshot: vi.fn().mockResolvedValueOnce(mockSnapshot) };
    vi.mocked(Box.get).mockResolvedValueOnce(mockBox as any);

    await snapshotCommand("box-1", { token: "key" });

    const call = mockBox.snapshot.mock.calls[0]![0] as { name: string };
    expect(call.name).toMatch(/^snapshot-\d+$/);
  });
});
