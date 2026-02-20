import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getCommand } from "../../commands/get.js";

vi.mock("@upstash/box", () => ({
  Box: {
    get: vi.fn(),
  },
}));

vi.mock("../../auth.js", () => ({
  resolveToken: vi.fn((token?: string) => token ?? "resolved-token"),
}));

import { Box } from "@upstash/box";

describe("getCommand", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("prints box details as JSON", async () => {
    vi.mocked(Box.get).mockResolvedValueOnce({ id: "box-1" } as any);

    await getCommand("box-1", { token: "key" });

    expect(Box.get).toHaveBeenCalledWith("box-1", { apiKey: "key" });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"id": "box-1"'));
  });
});
