import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Box, BoxError } from "../client.js";
import { mockResponse, TEST_BOX_DATA, TEST_CONFIG } from "./helpers.js";

describe("Box.get", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.UPSTASH_BOX_API_KEY;
  });
  afterEach(() => vi.restoreAllMocks());

  it("fetches an existing box by ID", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(TEST_BOX_DATA));

    const box = await Box.get("box-123", {
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
    });
    expect(box.id).toBe("box-123");

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${TEST_CONFIG.baseUrl}/v2/box/box-123`);
    expect(init?.method).toBeUndefined(); // GET is default
    expect((init?.headers as Record<string, string>)["X-Box-Api-Key"]).toBe("test-api-key");
  });

  it("throws on 404", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ error: "box not found" }, 404));

    await expect(
      Box.get("nonexistent", { apiKey: TEST_CONFIG.apiKey, baseUrl: TEST_CONFIG.baseUrl }),
    ).rejects.toThrow("box not found");
  });

  it("throws when apiKey is missing", async () => {
    await expect(Box.get("box-123")).rejects.toThrow("apiKey is required");
  });

  it("uses env var for apiKey", async () => {
    process.env.UPSTASH_BOX_API_KEY = "env-key";
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(TEST_BOX_DATA));

    const box = await Box.get("box-123");
    expect(box.id).toBe("box-123");
  });

  it("passes gitToken and timeout options", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(TEST_BOX_DATA));

    const box = await Box.get("box-123", {
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
      gitToken: "gh-tok",
      timeout: 30000,
      debug: true,
    });
    expect(box.id).toBe("box-123");
  });
});
