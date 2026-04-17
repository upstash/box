import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Box, BoxError } from "../client.js";
import { mockResponse, TEST_CONFIG } from "./helpers.js";

describe("Box.setEnv", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.UPSTASH_BOX_API_KEY;
  });
  afterEach(() => vi.restoreAllMocks());

  it("sends PUT to /v2/box/settings/env/:key with value", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}));

    await Box.setEnv("MY_KEY", "my-value", {
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${TEST_CONFIG.baseUrl}/v2/box/settings/env/MY_KEY`);
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(init?.body as string)).toEqual({ value: "my-value" });
    expect((init?.headers as Record<string, string>)["X-Box-Api-Key"]).toBe(TEST_CONFIG.apiKey);
  });

  it("URL-encodes the key", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}));

    await Box.setEnv("MY KEY/SLASH", "v", {
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
    });

    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${TEST_CONFIG.baseUrl}/v2/box/settings/env/MY%20KEY%2FSLASH`);
  });

  it("uses UPSTASH_BOX_API_KEY env var", async () => {
    process.env.UPSTASH_BOX_API_KEY = "env-key";
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}));

    await Box.setEnv("K", "v");

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect((init?.headers as Record<string, string>)["X-Box-Api-Key"]).toBe("env-key");
  });

  it("throws when apiKey is missing", async () => {
    await expect(Box.setEnv("K", "v")).rejects.toThrow("apiKey is required");
  });

  it("throws on API error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ error: "forbidden" }, 403));

    await expect(
      Box.setEnv("K", "v", { apiKey: TEST_CONFIG.apiKey, baseUrl: TEST_CONFIG.baseUrl }),
    ).rejects.toThrow("forbidden");
  });
});

describe("Box.listEnv", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.UPSTASH_BOX_API_KEY;
  });
  afterEach(() => vi.restoreAllMocks());

  it("sends GET to /v2/box/settings/env and returns env_vars", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      mockResponse({ env_vars: { FOO: "****", BAR: "****" } }),
    );

    const result = await Box.listEnv({ apiKey: TEST_CONFIG.apiKey, baseUrl: TEST_CONFIG.baseUrl });

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${TEST_CONFIG.baseUrl}/v2/box/settings/env`);
    expect(init?.method).toBeUndefined();
    expect(result).toEqual({ FOO: "****", BAR: "****" });
  });

  it("returns empty object when no env vars", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ env_vars: {} }));

    const result = await Box.listEnv({ apiKey: TEST_CONFIG.apiKey, baseUrl: TEST_CONFIG.baseUrl });
    expect(result).toEqual({});
  });

  it("throws when apiKey is missing", async () => {
    await expect(Box.listEnv()).rejects.toThrow("apiKey is required");
  });

  it("throws on API error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ error: "unauthorized" }, 401));

    await expect(
      Box.listEnv({ apiKey: TEST_CONFIG.apiKey, baseUrl: TEST_CONFIG.baseUrl }),
    ).rejects.toThrow("unauthorized");
  });
});

describe("Box.deleteEnv", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.UPSTASH_BOX_API_KEY;
  });
  afterEach(() => vi.restoreAllMocks());

  it("sends DELETE to /v2/box/settings/env/:key", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}));

    await Box.deleteEnv("MY_KEY", { apiKey: TEST_CONFIG.apiKey, baseUrl: TEST_CONFIG.baseUrl });

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${TEST_CONFIG.baseUrl}/v2/box/settings/env/MY_KEY`);
    expect(init?.method).toBe("DELETE");
  });

  it("URL-encodes the key", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}));

    await Box.deleteEnv("MY KEY", { apiKey: TEST_CONFIG.apiKey, baseUrl: TEST_CONFIG.baseUrl });

    const [url] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${TEST_CONFIG.baseUrl}/v2/box/settings/env/MY%20KEY`);
  });

  it("throws when apiKey is missing", async () => {
    await expect(Box.deleteEnv("K")).rejects.toThrow("apiKey is required");
  });

  it("throws on API error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ error: "not found" }, 404));

    await expect(
      Box.deleteEnv("K", { apiKey: TEST_CONFIG.apiKey, baseUrl: TEST_CONFIG.baseUrl }),
    ).rejects.toThrow("not found");
  });
});

describe("Box.setAllEnv", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.UPSTASH_BOX_API_KEY;
  });
  afterEach(() => vi.restoreAllMocks());

  it("sends PUT to /v2/box/settings/env with env_vars", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}));

    await Box.setAllEnv(
      { FOO: "bar", BAZ: "qux" },
      { apiKey: TEST_CONFIG.apiKey, baseUrl: TEST_CONFIG.baseUrl },
    );

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${TEST_CONFIG.baseUrl}/v2/box/settings/env`);
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(init?.body as string)).toEqual({ env_vars: { FOO: "bar", BAZ: "qux" } });
  });

  it("sends empty object to clear all env vars", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({}));

    await Box.setAllEnv({}, { apiKey: TEST_CONFIG.apiKey, baseUrl: TEST_CONFIG.baseUrl });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body).toEqual({ env_vars: {} });
  });

  it("throws when apiKey is missing", async () => {
    await expect(Box.setAllEnv({ K: "v" })).rejects.toThrow("apiKey is required");
  });

  it("throws on API error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ error: "bad request" }, 400));

    await expect(
      Box.setAllEnv({ K: "v" }, { apiKey: TEST_CONFIG.apiKey, baseUrl: TEST_CONFIG.baseUrl }),
    ).rejects.toThrow("bad request");
  });
});
