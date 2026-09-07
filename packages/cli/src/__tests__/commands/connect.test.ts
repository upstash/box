import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CliError } from "../../core/errors.js";
import { connectCommand } from "../../commands/connect.js";

vi.mock("@upstash/box", () => ({
  Box: {
    get: vi.fn(),
    list: vi.fn(),
  },
}));

vi.mock("../../repl/terminal.js", () => ({
  startRepl: vi.fn(),
}));

vi.mock("../../utils/interactive-select.js", () => ({
  interactiveSelect: vi.fn(),
}));

vi.mock("../../auth.js", () => ({
  resolveToken: vi.fn((token?: string) => token ?? "resolved-token"),
}));

import { Box } from "@upstash/box";
import { startRepl } from "../../repl/terminal.js";

describe("connectCommand", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("connects to box by ID", async () => {
    const mockBox = { id: "box-1" };
    vi.mocked(Box.get).mockResolvedValueOnce(mockBox as any);

    await connectCommand("box-1", { token: "key" });

    expect(Box.get).toHaveBeenCalledWith("box-1", { apiKey: "key" });
    expect(startRepl).toHaveBeenCalledWith(mockBox);
  });

  it("connects to most recent box when no ID", async () => {
    const mockBox = { id: "box-recent" };
    vi.mocked(Box.list).mockResolvedValueOnce([{ id: "box-recent", status: "idle" } as any]);
    vi.mocked(Box.get).mockResolvedValueOnce(mockBox as any);

    await connectCommand(undefined, { token: "key" });

    expect(Box.list).toHaveBeenCalledWith({ apiKey: "key" });
    expect(Box.get).toHaveBeenCalledWith("box-recent", { apiKey: "key" });
    expect(startRepl).toHaveBeenCalledWith(mockBox);
  });

  it("shows single-box message when only one box exists", async () => {
    const mockBox = { id: "box-only" };
    vi.mocked(Box.list).mockResolvedValueOnce([{ id: "box-only", status: "idle" } as any]);
    vi.mocked(Box.get).mockResolvedValueOnce(mockBox as any);

    await connectCommand(undefined, { token: "key" });

    expect(logSpy).toHaveBeenCalledWith("Only one box found, using it...");
  });

  it("exits when no boxes found", async () => {
    vi.mocked(Box.list).mockResolvedValueOnce([]);

    await expect(connectCommand(undefined, { token: "key" })).rejects.toThrow(/No boxes found/);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("filters out deleted boxes", async () => {
    vi.mocked(Box.list).mockResolvedValueOnce([{ id: "box-deleted", status: "deleted" } as any]);

    await expect(connectCommand(undefined, { token: "key" })).rejects.toThrow(/No boxes found/);
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
