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

  it("prints boxes with formatted dates and labels", async () => {
    vi.mocked(Box.list).mockResolvedValueOnce([
      {
        id: "box-1",
        name: "my-app",
        status: "running",
        model: "claude",
        created_at: 1735689600,
        labels: ["beta", "x-team"],
      },
      { id: "box-2", status: "stopped", model: "gpt", created_at: 1735776000 },
    ] as any);

    await listCommand({ token: "key" });

    const calls = logSpy.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls[0]).toMatch(/^ID\s+STATUS\s+MODEL\s+CREATED\s+NAME\s+LABELS/);
    // Verify dates are formatted (e.g. "Jan 1, 2025, 00:00") not raw numbers
    expect(calls[1]).not.toContain("1735689600");
    expect(calls[1]).toMatch(/^box-1\s+running\s+claude\s+\d{2}:\d{2} \w+ \d+, \d{4}/);
    expect(calls[1]).toMatch(/my-app/);
    expect(calls[1]).toContain("beta, x-team");
    expect(calls[2]).toMatch(/^box-2\s+stopped\s+gpt\s+\d{2}:\d{2} \w+ \d+, \d{4}/);
  });

  it("passes the label filter to Box.list", async () => {
    vi.mocked(Box.list).mockResolvedValueOnce([]);

    await listCommand({ token: "key", label: "beta" });

    expect(Box.list).toHaveBeenCalledWith(expect.objectContaining({ label: "beta" }));
  });

  it("prints message when empty", async () => {
    vi.mocked(Box.list).mockResolvedValueOnce([]);

    await listCommand({ token: "key" });

    expect(logSpy).toHaveBeenCalledWith("No boxes found.");
  });

  it("prints label-specific message when filtered result is empty", async () => {
    vi.mocked(Box.list).mockResolvedValueOnce([]);

    await listCommand({ token: "key", label: "beta" });

    expect(logSpy).toHaveBeenCalledWith('No boxes found with label "beta".');
  });
});
