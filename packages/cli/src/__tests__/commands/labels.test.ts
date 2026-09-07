import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { labelAddCommand, labelRemoveCommand, labelListCommand } from "../../commands/labels.js";

const mockLabels = {
  add: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
};

vi.mock("@upstash/box", () => ({
  Box: {
    get: vi.fn(),
  },
}));

vi.mock("../../auth.js", () => ({
  resolveToken: vi.fn((token?: string) => token ?? "resolved-token"),
}));

import { Box } from "@upstash/box";

describe("labels commands", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let stdout: ReturnType<typeof vi.spyOn>;
  const written = () => stdout.mock.calls.map((call) => String(call[0])).join("");

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.mocked(Box.get).mockResolvedValue({ id: "box-1", labels: mockLabels } as any);
  });

  afterEach(() => vi.restoreAllMocks());

  it("add sends the label and prints updated set", async () => {
    mockLabels.add.mockResolvedValueOnce(["beta", "x-team"]);

    await labelAddCommand("box-1", "x-team", { token: "key" });

    expect(Box.get).toHaveBeenCalledWith("box-1", { apiKey: "key" });
    expect(mockLabels.add).toHaveBeenCalledWith("x-team");
    expect(written()).toContain("beta, x-team");
  });

  it("remove sends the label and prints updated set", async () => {
    mockLabels.remove.mockResolvedValueOnce(["x-team"]);

    await labelRemoveCommand("box-1", "beta", { token: "key" });

    expect(mockLabels.remove).toHaveBeenCalledWith("beta");
    expect(written()).toContain("x-team");
  });

  it("list prints each label", async () => {
    mockLabels.list.mockResolvedValueOnce(["beta", "x-team"]);

    await labelListCommand("box-1", { token: "key" });

    expect(mockLabels.list).toHaveBeenCalled();
    expect(written()).toContain("beta");
    expect(written()).toContain("x-team");
  });

  it("says so on stderr when there are no labels, leaving stdout empty", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockLabels.list.mockResolvedValueOnce([]);

    await labelListCommand("box-1", { token: "key" });

    expect(stderr.mock.calls.map((c) => String(c[0])).join("")).toContain("No labels.");
    expect(written()).toBe("");
  });

  it("emits an empty array under --json rather than a message", async () => {
    mockLabels.list.mockResolvedValueOnce([]);
    await labelListCommand("box-1", { token: "key", json: true });
    expect(JSON.parse(written())).toEqual([]);
  });
});
