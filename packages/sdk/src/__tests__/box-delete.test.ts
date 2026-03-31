import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Box, BoxError } from "../client.js";
import { mockResponse, TEST_CONFIG } from "./helpers.js";

describe("Box.delete (static)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.UPSTASH_BOX_API_KEY;
  });
  afterEach(() => vi.restoreAllMocks());

  it("deletes a single box by ID", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}));

    await Box.delete({ apiKey: TEST_CONFIG.apiKey, baseUrl: TEST_CONFIG.baseUrl, boxIds: "box-1" });

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${TEST_CONFIG.baseUrl}/v2/box`);
    expect(init?.method).toBe("DELETE");
    const body = JSON.parse(init?.body as string);
    expect(body.ids).toEqual(["box-1"]);
  });

  it("deletes multiple boxes by ID", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}));

    await Box.delete({
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
      boxIds: ["box-1", "box-2", "box-3"],
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.ids).toEqual(["box-1", "box-2", "box-3"]);
  });

  it("throws when apiKey is missing", async () => {
    await expect(Box.delete({ boxIds: "box-1" })).rejects.toThrow("apiKey is required");
  });

  it("uses env var for apiKey", async () => {
    process.env.UPSTASH_BOX_API_KEY = "env-key";
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}));

    await Box.delete({ boxIds: "box-1" });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect((init?.headers as Record<string, string>)["X-Box-Api-Key"]).toBe("env-key");
  });

  it("throws on API error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ error: "not found" }, 404));

    await expect(
      Box.delete({ apiKey: TEST_CONFIG.apiKey, baseUrl: TEST_CONFIG.baseUrl, boxIds: "bad-id" }),
    ).rejects.toThrow("not found");
  });
});
