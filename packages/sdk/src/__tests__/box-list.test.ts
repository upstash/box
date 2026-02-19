import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Box, BoxError } from "../client.js";
import { mockResponse, TEST_BOX_DATA, TEST_CONFIG } from "./helpers.js";

describe("Box.list", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.UPSTASH_BOX_API_KEY;
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns list of boxes", async () => {
    const boxes = [TEST_BOX_DATA, { ...TEST_BOX_DATA, id: "box-456" }];
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(boxes));

    const result = await Box.list({ apiKey: TEST_CONFIG.apiKey, baseUrl: TEST_CONFIG.baseUrl });
    expect(result).toHaveLength(2);
    expect(result[0]!.id).toBe("box-123");
    expect(result[1]!.id).toBe("box-456");

    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${TEST_CONFIG.baseUrl}/v2/box`);
  });

  it("returns empty array", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse([]));

    const result = await Box.list({ apiKey: TEST_CONFIG.apiKey, baseUrl: TEST_CONFIG.baseUrl });
    expect(result).toEqual([]);
  });

  it("throws when apiKey is missing", async () => {
    await expect(Box.list()).rejects.toThrow("apiKey is required");
  });

  it("uses env var for apiKey", async () => {
    process.env.UPSTASH_BOX_API_KEY = "env-key";
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse([]));

    await Box.list();
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect((init?.headers as Record<string, string>)["X-Box-Api-Key"]).toBe("env-key");
  });

  it("throws on API error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse({ error: "unauthorized" }, 401),
    );

    await expect(
      Box.list({ apiKey: TEST_CONFIG.apiKey, baseUrl: TEST_CONFIG.baseUrl }),
    ).rejects.toThrow("unauthorized");
  });
});
