import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Box, BoxError } from "../client.js";
import { mockResponse, TEST_CONFIG } from "./helpers.js";
import type { ApiKey, CreateApiKeyResponse } from "../types.js";

const TEST_API_KEY: ApiKey = {
  id: "key-1",
  api_key_prefix: "bx_test_",
  created_at: 1700000000,
};

const TEST_CREATE_RESPONSE: CreateApiKeyResponse = {
  api_key: "bx_test_secretvalue1234",
  created_at: 1700000000,
};

// ──────────────────────────────────────────────────────────────────────────────
// Box.createApiKey
// ──────────────────────────────────────────────────────────────────────────────

describe("Box.createApiKey", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.UPSTASH_BOX_API_KEY;
  });
  afterEach(() => vi.restoreAllMocks());

  it("POSTs to /v2/box/apikey and returns the new key", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(TEST_CREATE_RESPONSE));

    const result = await Box.createApiKey({
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
    });

    expect(result.api_key).toBe("bx_test_secretvalue1234");
    expect(result.created_at).toBe(1700000000);

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${TEST_CONFIG.baseUrl}/v2/box/apikey`);
    expect(init?.method).toBe("POST");
  });

  it("sends Content-Type: application/json and auth header", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(TEST_CREATE_RESPONSE));

    await Box.createApiKey({ apiKey: TEST_CONFIG.apiKey, baseUrl: TEST_CONFIG.baseUrl });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["X-Box-Api-Key"]).toBe(TEST_CONFIG.apiKey);
  });

  it("throws BoxError when apiKey is missing", async () => {
    await expect(Box.createApiKey()).rejects.toThrow("apiKey is required");
    await expect(Box.createApiKey()).rejects.toThrow(BoxError);
  });

  it("uses UPSTASH_BOX_API_KEY env var", async () => {
    process.env.UPSTASH_BOX_API_KEY = "env-key";
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(TEST_CREATE_RESPONSE));

    await Box.createApiKey();

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect((init?.headers as Record<string, string>)["X-Box-Api-Key"]).toBe("env-key");
  });

  it("throws on API error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ error: "limit reached" }, 429));

    await expect(
      Box.createApiKey({ apiKey: TEST_CONFIG.apiKey, baseUrl: TEST_CONFIG.baseUrl }),
    ).rejects.toThrow("limit reached");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Box.listApiKeys
// ──────────────────────────────────────────────────────────────────────────────

describe("Box.listApiKeys", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.UPSTASH_BOX_API_KEY;
  });
  afterEach(() => vi.restoreAllMocks());

  it("GETs /v2/box/apikeys and returns ApiKey[]", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ keys: [TEST_API_KEY] }));

    const keys = await Box.listApiKeys({
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
    });

    expect(keys).toHaveLength(1);
    expect(keys[0]!.id).toBe("key-1");
    expect(keys[0]!.api_key_prefix).toBe("bx_test_");

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${TEST_CONFIG.baseUrl}/v2/box/apikeys`);
    expect(init?.method).toBe("GET");
  });

  it("returns an empty array when there are no keys", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ keys: [] }));

    const keys = await Box.listApiKeys({
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
    });
    expect(keys).toEqual([]);
  });

  it("returns an empty array when keys field is missing", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}));

    const keys = await Box.listApiKeys({
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
    });
    expect(keys).toEqual([]);
  });

  it("returns multiple keys", async () => {
    const multiKeys: ApiKey[] = [
      { id: "key-1", api_key_prefix: "bx_a_", created_at: 1700000000 },
      { id: "key-2", api_key_prefix: "bx_b_", created_at: 1700000001 },
    ];
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ keys: multiKeys }));

    const keys = await Box.listApiKeys({
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
    });
    expect(keys).toHaveLength(2);
    expect(keys[1]!.id).toBe("key-2");
  });

  it("sends the correct auth header", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ keys: [] }));

    await Box.listApiKeys({ apiKey: TEST_CONFIG.apiKey, baseUrl: TEST_CONFIG.baseUrl });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect((init?.headers as Record<string, string>)["X-Box-Api-Key"]).toBe(TEST_CONFIG.apiKey);
  });

  it("throws BoxError when apiKey is missing", async () => {
    await expect(Box.listApiKeys()).rejects.toThrow("apiKey is required");
    await expect(Box.listApiKeys()).rejects.toThrow(BoxError);
  });

  it("uses UPSTASH_BOX_API_KEY env var", async () => {
    process.env.UPSTASH_BOX_API_KEY = "env-key";
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ keys: [] }));

    await Box.listApiKeys();

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect((init?.headers as Record<string, string>)["X-Box-Api-Key"]).toBe("env-key");
  });

  it("throws on API error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ error: "unauthorized" }, 401));

    await expect(
      Box.listApiKeys({ apiKey: "bad-key", baseUrl: TEST_CONFIG.baseUrl }),
    ).rejects.toThrow("unauthorized");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Box.revokeApiKey
// ──────────────────────────────────────────────────────────────────────────────

describe("Box.revokeApiKey", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.UPSTASH_BOX_API_KEY;
  });
  afterEach(() => vi.restoreAllMocks());

  it("DELETEs /v2/box/apikey/:keyId", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}, 200));

    await Box.revokeApiKey("key-1", {
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${TEST_CONFIG.baseUrl}/v2/box/apikey/key-1`);
    expect(init?.method).toBe("DELETE");
  });

  it("includes the keyId in the URL path", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}));

    await Box.revokeApiKey("key-xyz-999", {
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
    });

    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toContain("/apikey/key-xyz-999");
  });

  it("sends the correct auth header", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}));

    await Box.revokeApiKey("key-1", {
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
    });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect((init?.headers as Record<string, string>)["X-Box-Api-Key"]).toBe(TEST_CONFIG.apiKey);
  });

  it("resolves to void on success", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}));

    const result = await Box.revokeApiKey("key-1", {
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
    });
    expect(result).toBeUndefined();
  });

  it("throws BoxError when apiKey is missing", async () => {
    await expect(Box.revokeApiKey("key-1")).rejects.toThrow("apiKey is required");
    await expect(Box.revokeApiKey("key-1")).rejects.toThrow(BoxError);
  });

  it("uses UPSTASH_BOX_API_KEY env var", async () => {
    process.env.UPSTASH_BOX_API_KEY = "env-key";
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}));

    await Box.revokeApiKey("key-1");

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect((init?.headers as Record<string, string>)["X-Box-Api-Key"]).toBe("env-key");
  });

  it("throws on API error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ error: "key not found" }, 404));

    await expect(
      Box.revokeApiKey("nonexistent", {
        apiKey: TEST_CONFIG.apiKey,
        baseUrl: TEST_CONFIG.baseUrl,
      }),
    ).rejects.toThrow("key not found");
  });
});
