import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Box, BoxError } from "../client.js";
import { mockResponse, TEST_BOX_DATA, TEST_CONFIG } from "./helpers.js";

describe("Box.fromSnapshot", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.UPSTASH_BOX_API_KEY;
  });
  afterEach(() => vi.restoreAllMocks());

  it("creates a box from snapshot (already running)", async () => {
    const data = { ...TEST_BOX_DATA, status: "running" };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(data));

    const box = await Box.fromSnapshot("snap-1", TEST_CONFIG);
    expect(box.id).toBe("box-123");

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe(`${TEST_CONFIG.baseUrl}/v2/box/from-snapshot`);
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body.snapshot_id).toBe("snap-1");
    expect(body.model).toBe("claude/sonnet_4_5");
  });

  it("polls until box is ready", async () => {
    const creating = { ...TEST_BOX_DATA, status: "creating" };
    const running = { ...TEST_BOX_DATA, status: "running" };

    vi.mocked(fetch)
      .mockResolvedValueOnce(mockResponse(creating))
      .mockResolvedValueOnce(mockResponse(running));

    const box = await Box.fromSnapshot("snap-1", TEST_CONFIG);
    expect(box.id).toBe("box-123");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("throws on error status", async () => {
    const creating = { ...TEST_BOX_DATA, status: "creating" };
    const errorState = { ...TEST_BOX_DATA, status: "error" };

    vi.mocked(fetch)
      .mockResolvedValueOnce(mockResponse(creating))
      .mockResolvedValueOnce(mockResponse(errorState));

    await expect(Box.fromSnapshot("snap-1", TEST_CONFIG)).rejects.toThrow(
      "Box creation from snapshot failed",
    );
  });

  it("throws when apiKey is missing", async () => {
    const config = { ...TEST_CONFIG, apiKey: undefined };
    await expect(Box.fromSnapshot("snap-1", config)).rejects.toThrow("apiKey is required");
  });

  it("throws when git is provided without token", async () => {
    const config = { ...TEST_CONFIG, git: {} };
    await expect(Box.fromSnapshot("snap-1", config)).rejects.toThrow(
      "git.token is required when git is configured",
    );
  });

  it("sends runtime and gitToken in body", async () => {
    const data = { ...TEST_BOX_DATA, status: "running" };
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse(data));

    await Box.fromSnapshot("snap-1", {
      ...TEST_CONFIG,
      runtime: "python",
      git: { token: "gh-tok" },
    });

    const body = JSON.parse(vi.mocked(fetch).mock.calls[0]![1]?.body as string);
    expect(body.runtime).toBe("python");
    expect(body.github_token).toBe("gh-tok");
  });

  it("throws on API error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(mockResponse({ error: "snapshot not found" }, 404));

    await expect(Box.fromSnapshot("bad-snap", TEST_CONFIG)).rejects.toThrow("snapshot not found");
  });
});
