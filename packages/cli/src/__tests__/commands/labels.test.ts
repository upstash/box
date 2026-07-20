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

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.mocked(Box.get).mockResolvedValue({ id: "box-1", labels: mockLabels } as any);
  });

  afterEach(() => vi.restoreAllMocks());

  it("add sends the label and prints updated set", async () => {
    mockLabels.add.mockResolvedValueOnce(["beta", "x-team"]);

    await labelAddCommand("box-1", "x-team", { token: "key" });

    expect(Box.get).toHaveBeenCalledWith("box-1", { apiKey: "key" });
    expect(mockLabels.add).toHaveBeenCalledWith("x-team");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("beta, x-team"));
  });

  it("remove sends the label and prints updated set", async () => {
    mockLabels.remove.mockResolvedValueOnce(["x-team"]);

    await labelRemoveCommand("box-1", "beta", { token: "key" });

    expect(mockLabels.remove).toHaveBeenCalledWith("beta");
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("x-team"));
  });

  it("list prints each label", async () => {
    mockLabels.list.mockResolvedValueOnce(["beta", "x-team"]);

    await labelListCommand("box-1", { token: "key" });

    expect(mockLabels.list).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("beta");
    expect(logSpy).toHaveBeenCalledWith("x-team");
  });

  it("list prints a message when there are no labels", async () => {
    mockLabels.list.mockResolvedValueOnce([]);

    await labelListCommand("box-1", { token: "key" });

    expect(logSpy).toHaveBeenCalledWith("No labels.");
  });
});
