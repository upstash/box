import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { listCommand } from "../../commands/list.js";

vi.mock("@buggyhunter/box", () => ({
  Box: {
    list: vi.fn(),
  },
}));

vi.mock("../../auth.js", () => ({
  resolveToken: vi.fn((token?: string) => token ?? "resolved-token"),
}));

import { Box } from "@buggyhunter/box";

describe("listCommand", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("prints boxes", async () => {
    vi.mocked(Box.list).mockResolvedValueOnce([
      { id: "box-1", status: "running", model: "claude", created_at: "2025-01-01" },
      { id: "box-2", status: "stopped", model: "gpt", created_at: "2025-01-02" },
    ] as any);

    await listCommand({ token: "key" });

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("box-1"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("box-2"));
  });

  it("prints message when empty", async () => {
    vi.mocked(Box.list).mockResolvedValueOnce([]);

    await listCommand({ token: "key" });

    expect(logSpy).toHaveBeenCalledWith("No boxes found.");
  });
});
