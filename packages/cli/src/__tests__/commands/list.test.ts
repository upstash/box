import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { listCommand } from "../../commands/list.js";

vi.mock("@upstash/box", () => ({
  Box: {
    list: vi.fn(),
  },
}));

vi.mock("../../auth.js", () => ({
  resolveToken: vi.fn((token?: string) => token ?? "resolved-token"),
}));

import { Box } from "@upstash/box";

describe("listCommand", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("prints boxes", async () => {
    vi.mocked(Box.list).mockResolvedValueOnce([
      { id: "box-1", name: "my-app", status: "running", model: "claude", created_at: "2025-01-01" },
      { id: "box-2", status: "stopped", model: "gpt", created_at: "2025-01-02" },
    ] as any);

    await listCommand({ token: "key" });

    const calls = logSpy.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls[0]).toMatch(/^ID\s+NAME\s+STATUS\s+MODEL\s+CREATED/);
    expect(calls[1]).toMatch(/^box-1\s+my-app\s+running\s+claude\s+2025-01-01/);
    expect(calls[2]).toMatch(/^box-2\s+stopped\s+gpt\s+2025-01-02/);
  });

  it("prints message when empty", async () => {
    vi.mocked(Box.list).mockResolvedValueOnce([]);

    await listCommand({ token: "key" });

    expect(logSpy).toHaveBeenCalledWith("No boxes found.");
  });
});
