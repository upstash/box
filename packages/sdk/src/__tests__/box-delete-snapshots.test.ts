import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Box, BoxError } from "../client.js";
import { mockResponse, TEST_CONFIG } from "./helpers.js";

const CONN = { apiKey: TEST_CONFIG.apiKey, baseUrl: TEST_CONFIG.baseUrl };

describe("Box.deleteSnapshots (static)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.UPSTASH_BOX_API_KEY;
  });
  afterEach(() => vi.restoreAllMocks());

  it("deletes all snapshots when no snapshotIds provided", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ deleted: 3 }));

    const result = await Box.deleteSnapshots({
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${TEST_CONFIG.baseUrl}/v2/box/snapshots?all=true`);
    expect(init?.method).toBe("DELETE");
    const body = JSON.parse(init?.body as string);
    expect(body.ids).toBeUndefined();
    expect(result).toEqual({ deleted: 3 });
  });

  it("does not ask for everything when ids are named", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ deleted: 1 }));

    await Box.deleteSnapshots({ ...CONN, snapshotIds: ["snap-1"] });

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${TEST_CONFIG.baseUrl}/v2/box/snapshots`);
    expect(JSON.parse(init?.body as string).ids).toEqual(["snap-1"]);
  });

  it.each([
    ["an empty array", []],
    ["an empty string", ""],
    ["a blank id in the list", ["snap-1", " "]],
  ])("rejects %s instead of deleting every snapshot", async (_label, snapshotIds) => {
    await expect(Box.deleteSnapshots({ ...CONN, snapshotIds })).rejects.toThrow(
      "snapshotIds must contain at least one non-empty id",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("deletes a single snapshot by ID", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ deleted: 1 }));

    const result = await Box.deleteSnapshots({
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
      snapshotIds: "snap-1",
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.ids).toEqual(["snap-1"]);
    expect(result).toEqual({ deleted: 1 });
  });

  it("deletes multiple snapshots by ID", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ deleted: 2 }));

    const result = await Box.deleteSnapshots({
      apiKey: TEST_CONFIG.apiKey,
      baseUrl: TEST_CONFIG.baseUrl,
      snapshotIds: ["snap-1", "snap-2"],
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.ids).toEqual(["snap-1", "snap-2"]);
    expect(result).toEqual({ deleted: 2 });
  });

  it("throws when apiKey is missing", async () => {
    await expect(Box.deleteSnapshots()).rejects.toThrow("apiKey is required");
  });

  it("uses env var for apiKey", async () => {
    process.env.UPSTASH_BOX_API_KEY = "env-key";
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ deleted: 0 }));

    await Box.deleteSnapshots();

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect((init?.headers as Record<string, string>)["X-Box-Api-Key"]).toBe("env-key");
  });

  it("throws on API error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ error: "unauthorized" }, 401));

    await expect(
      Box.deleteSnapshots({ apiKey: TEST_CONFIG.apiKey, baseUrl: TEST_CONFIG.baseUrl }),
    ).rejects.toThrow("unauthorized");
  });
});
