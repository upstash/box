import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EphemeralBox, BoxError } from "../client.js";
import { mockResponse, TEST_BOX_DATA } from "./helpers.js";

const EPHEMERAL_BOX_DATA = {
  ...TEST_BOX_DATA,
  status: "idle",
  ephemeral: true,
  expires_at: 1773745700,
};

const EPHEMERAL_CONFIG = {
  apiKey: "test-api-key",
  baseUrl: "https://test.api.example.com",
};

describe("EphemeralBox.fromSnapshot", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.UPSTASH_BOX_API_KEY;
    delete process.env.UPSTASH_BOX_BASE_URL;
  });
  afterEach(() => vi.restoreAllMocks());

  it("creates an ephemeral box from snapshot", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(EPHEMERAL_BOX_DATA));

    const box = await EphemeralBox.fromSnapshot("snap-1", EPHEMERAL_CONFIG);

    expect(box.id).toBe("box-123");
    expect(box.expiresAt).toBe(1773745700);

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${EPHEMERAL_CONFIG.baseUrl}/v2/box/from-snapshot`);
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body.snapshot_id).toBe("snap-1");
    expect(body.ephemeral).toBe(true);
  });

  it("does not poll — returns immediately", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(EPHEMERAL_BOX_DATA));

    await EphemeralBox.fromSnapshot("snap-1", EPHEMERAL_CONFIG);

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("sends labels in body when provided", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(EPHEMERAL_BOX_DATA));

    await EphemeralBox.fromSnapshot("snap-1", { ...EPHEMERAL_CONFIG, labels: ["beta", "x-team"] });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.labels).toEqual(["beta", "x-team"]);
  });

  it("sends runtime and ttl in body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(EPHEMERAL_BOX_DATA));

    await EphemeralBox.fromSnapshot("snap-1", {
      ...EPHEMERAL_CONFIG,
      runtime: "python",
      ttl: 1800,
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.snapshot_id).toBe("snap-1");
    expect(body.ephemeral).toBe(true);
    expect(body.runtime).toBe("python");
    expect(body.ttl).toBe(1800);
  });

  it("sends ttl: 0 when explicitly set", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(EPHEMERAL_BOX_DATA));

    await EphemeralBox.fromSnapshot("snap-1", { ...EPHEMERAL_CONFIG, ttl: 0 });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.ttl).toBe(0);
  });

  it("throws when apiKey is missing", async () => {
    await expect(EphemeralBox.fromSnapshot("snap-1")).rejects.toThrow("apiKey is required");
  });

  it("uses env var for apiKey", async () => {
    process.env.UPSTASH_BOX_API_KEY = "env-key";
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(EPHEMERAL_BOX_DATA));

    const box = await EphemeralBox.fromSnapshot("snap-1");
    expect(box.id).toBe("box-123");

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect((init?.headers as Record<string, string>)["X-Box-Api-Key"]).toBe("env-key");
  });

  it("throws on API error response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ error: "snapshot not found" }, 404));

    await expect(EphemeralBox.fromSnapshot("bad-snap", EPHEMERAL_CONFIG)).rejects.toThrow(
      "snapshot not found",
    );
  });

  it("sends env_vars in body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(EPHEMERAL_BOX_DATA));

    await EphemeralBox.fromSnapshot("snap-1", {
      ...EPHEMERAL_CONFIG,
      env: { DB_URL: "postgres://localhost", NODE_ENV: "test" },
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.env_vars).toEqual({ DB_URL: "postgres://localhost", NODE_ENV: "test" });
  });

  it("does not send env_vars when env is not set", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(EPHEMERAL_BOX_DATA));

    await EphemeralBox.fromSnapshot("snap-1", EPHEMERAL_CONFIG);

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.env_vars).toBeUndefined();
  });

  it("sends attach_headers in body", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(EPHEMERAL_BOX_DATA));

    await EphemeralBox.fromSnapshot("snap-1", {
      ...EPHEMERAL_CONFIG,
      attachHeaders: {
        "api.example.com": { "X-Secret": "hidden" },
      },
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.attach_headers).toEqual({
      "api.example.com": { "X-Secret": "hidden" },
    });
  });

  it("does not send attach_headers when not set", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(EPHEMERAL_BOX_DATA));

    await EphemeralBox.fromSnapshot("snap-1", EPHEMERAL_CONFIG);

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.attach_headers).toBeUndefined();
  });

  it("does not send agent or git fields", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(EPHEMERAL_BOX_DATA));

    await EphemeralBox.fromSnapshot("snap-1", EPHEMERAL_CONFIG);

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.model).toBeUndefined();
    expect(body.agent).toBeUndefined();
    expect(body.agent_api_key).toBeUndefined();
    expect(body.github_token).toBeUndefined();
  });

  it("exposes exec and files but not agent or git", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(EPHEMERAL_BOX_DATA));

    const box = await EphemeralBox.fromSnapshot("snap-1", EPHEMERAL_CONFIG);

    expect(box.exec).toBeDefined();
    expect(box.files).toBeDefined();
    expect((box as any).agent).toBeUndefined();
    expect((box as any).git).toBeUndefined();
    expect((box as any).preview).toBeUndefined();
  });
});
