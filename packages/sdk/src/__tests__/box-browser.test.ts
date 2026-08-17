import { Buffer } from "node:buffer";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import type {
  BrowserRecording,
  BrowserRecordingHandle,
  BrowserRecordingMarker,
  BrowserRecordingOptions,
} from "../index.js";
import { createTestBox, mockResponse } from "./helpers.js";

const { writeFileMock, mkdirMock, unlinkMock, renameMock } = vi.hoisted(() => ({
  writeFileMock: vi.fn().mockResolvedValue(undefined),
  mkdirMock: vi.fn().mockResolvedValue(undefined),
  unlinkMock: vi.fn().mockResolvedValue(undefined),
  renameMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("node:fs/promises", () => ({
  writeFile: writeFileMock,
  mkdir: mkdirMock,
  unlink: unlinkMock,
  rename: renameMock,
}));

// The un-mocked module, for tests that exercise real streaming writes.
const realFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");

type PublicRecordingTypes = [
  BrowserRecording,
  BrowserRecordingHandle,
  BrowserRecordingMarker,
  BrowserRecordingOptions,
];

function mockVideoResponse(contentType: string, bytes: Uint8Array): Response {
  return {
    ...mockResponse({}),
    headers: new Headers({ "content-type": contentType }),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  } as unknown as Response;
}

describe("Box browser operations", () => {
  beforeEach(() => {
    // Reset call history and per-test implementations, restoring the default
    // resolved-undefined so each test starts clean.
    writeFileMock.mockReset().mockResolvedValue(undefined);
    mkdirMock.mockReset().mockResolvedValue(undefined);
    unlinkMock.mockReset().mockResolvedValue(undefined);
    renameMock.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it("addresses page operations through a tab", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock
      .mockResolvedValueOnce(
        mockResponse({ id: "tab-1", url: "https://example.com", title: "Example Domain" }),
      )
      .mockResolvedValueOnce(
        mockResponse({
          title: "Example Domain",
          url: "https://example.com",
          text: "Example Domain",
          links: [{ text: "More information", href: "https://iana.org/help/example-domains" }],
        }),
      );

    const tab = await box.browser.tab.create("https://example.com", {
      waitUntil: "networkidle",
      timeout: 45_000,
    });
    const content = await tab.content();

    expect(tab.id).toBe("tab-1");
    expect(content.links?.[0]).toEqual({
      text: "More information",
      href: "https://iana.org/help/example-domains",
    });
    expect(fetchMock.mock.calls[2]?.[0]).toContain("browser/content?tab=tab-1");
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({
      url: "https://example.com",
      wait_until: "networkidle",
      timeout: 45_000,
    });
  });

  it("returns live-view and CDP URLs directly", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock
      .mockResolvedValueOnce(mockResponse({ id: "tab-1", url: "https://example.com" }))
      .mockResolvedValueOnce(
        mockResponse({
          screencast_url: "https://box.example/screencast?token=live-token&tab=tab-1",
        }),
      )
      .mockResolvedValueOnce(
        mockResponse({
          cdp_url: "wss://box.example?token=cdp-token",
        }),
      );

    const tab = await box.browser.tab.create("https://example.com");

    await expect(tab.liveViewUrl()).resolves.toBe(
      "https://box.example/screencast?token=live-token&tab=tab-1",
    );
    await expect(box.browser.cdpUrl()).resolves.toBe("wss://box.example?token=cdp-token");
    expect(fetchMock.mock.calls[2]?.[0]).toContain("browser/screencast");
    expect(fetchMock.mock.calls[3]?.[0]).toContain("browser/connect");
  });

  it("returns screenshot bytes or base64 and forwards fullPage", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock
      .mockResolvedValueOnce(mockResponse({ id: "tab-1", url: "https://example.com" }))
      .mockResolvedValueOnce(mockResponse({ data: "AQID" }))
      .mockResolvedValueOnce(mockResponse({ data: "AQID" }));

    const tab = await box.browser.tab.create("https://example.com");
    const png = await tab.screenshot();
    const base64 = await tab.screenshot({ type: "base64", fullPage: true });

    expect(png).toEqual(new Uint8Array([1, 2, 3]));
    expect(base64).toBe("AQID");
    expect(fetchMock.mock.calls[2]?.[0]).not.toContain("full_page");
    expect(fetchMock.mock.calls[3]?.[0]).toContain("full_page=true");
  });

  it("extracts with a Zod 4 schema", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock
      .mockResolvedValueOnce(mockResponse({ id: "tab-1", url: "https://example.com" }))
      .mockResolvedValueOnce(mockResponse({ data: { heading: "Example Domain" } }));

    const tab = await box.browser.tab.create("https://example.com");
    const result = await tab.extract("Extract the heading", z.object({ heading: z.string() }));

    expect(result).toEqual({ heading: "Example Domain" });
    const body = JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string);
    expect(body.schema).toMatchObject({
      type: "object",
      properties: { heading: { type: "string" } },
      required: ["heading"],
    });
  });

  it("executes one Stagehand-style action on the selected tab", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock
      .mockResolvedValueOnce(mockResponse({ id: "tab-2", url: "https://example.com/login" }))
      .mockResolvedValueOnce(
        mockResponse({
          success: true,
          message: "Action completed successfully",
          action_description: "Click the sign-in button",
          actions: [
            {
              selector: "xpath=/html/body/button",
              description: "Sign in",
              method: "click",
              arguments: [],
            },
          ],
          cache_status: "MISS",
          input_tokens: 30,
          output_tokens: 8,
        }),
      );

    const tab = await box.browser.tab.create("https://example.com/login");
    const result = await tab.act("click the sign-in button", { model: "openai/gpt-5" });

    expect(result).toEqual({
      success: true,
      message: "Action completed successfully",
      actionDescription: "Click the sign-in button",
      actions: [
        {
          selector: "xpath=/html/body/button",
          description: "Sign in",
          method: "click",
          arguments: [],
        },
      ],
      cacheStatus: "MISS",
      inputTokens: 30,
      outputTokens: 8,
    });
    expect(fetchMock.mock.calls[2]?.[0]).toContain("browser/act");
    expect(JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string)).toEqual({
      instruction: "click the sign-in button",
      tab: "tab-2",
      model: "openai/gpt-5",
    });
  });

  it("replays a pre-resolved action deterministically (posts action, not instruction)", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock
      .mockResolvedValueOnce(mockResponse({ id: "tab-2", url: "https://example.com/login" }))
      .mockResolvedValueOnce(
        mockResponse({
          success: true,
          message: "done",
          action_description: "Sign in",
          actions: [
            {
              selector: "xpath=/html/body/button",
              description: "Sign in",
              method: "click",
              arguments: [],
            },
          ],
          input_tokens: 0,
          output_tokens: 0,
        }),
      );

    const tab = await box.browser.tab.create("https://example.com/login");
    const action = {
      selector: "xpath=/html/body/button",
      description: "Sign in",
      method: "click",
      arguments: [],
    };
    const result = await tab.act(action);

    expect(result.success).toBe(true);
    expect(result.inputTokens).toBe(0);
    expect(fetchMock.mock.calls[2]?.[0]).toContain("browser/act");
    expect(JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string)).toEqual({
      action,
      tab: "tab-2",
    });
  });

  it("rejects an action with no selector before any request", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(
      mockResponse({ id: "tab-2", url: "https://example.com/login" }),
    );
    const tab = await box.browser.tab.create("https://example.com/login");
    await expect(tab.act({ description: "unresolved element" })).rejects.toThrow(
      "requires a selector",
    );
  });

  it("starts and stops a recording and maps its playback metadata", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock
      .mockResolvedValueOnce(
        mockResponse({
          id: "recording-1",
          box_id: "box-123",
          status: "recording",
          started_at: 1000,
          max_duration_seconds: 60,
        }),
      )
      // handle.stop() first checks the recording is still live
      .mockResolvedValueOnce(
        mockResponse({
          id: "recording-1",
          box_id: "box-123",
          status: "recording",
          started_at: 1000,
        }),
      )
      .mockResolvedValueOnce(
        mockResponse({
          id: "recording-1",
          box_id: "box-123",
          status: "completed",
          started_at: 1000,
          // expires_at arrives in epoch seconds (unlike the ms timestamps)
          expires_at: 1_209_601,
          ended_at: 5000,
          duration_ms: 4000,
          size_bytes: 0,
          segment_count: 2,
          stopped_reason: "max_duration",
          markers: [{ type: "tab_switch", at_ms: 250, label: "Example", tab_id: "tab-1" }],
        }),
      );

    const handle = await box.browser.recordings.start({ maxDurationSeconds: 60 });
    const recording = await handle.stop();

    expect(handle.id).toBe("recording-1");
    expect(recording).toMatchObject<Partial<PublicRecordingTypes[0]>>({
      id: "recording-1",
      status: "completed",
      durationMs: 4000,
      // 0 must survive mapping instead of collapsing to undefined
      sizeBytes: 0,
      segmentCount: 2,
      stoppedReason: "max_duration",
      // normalized from epoch seconds to ms
      expiresAt: 1_209_601_000,
    });
    expect(recording.markers[0]).toEqual({
      type: "tab_switch",
      atMs: 250,
      endMs: undefined,
      label: "Example",
      tabId: "tab-1",
    });
    expect(recording.playlistUrl).toContain(
      "/v2/box/box-123/browser/recordings/recording-1/playlist",
    );

    const startBody = JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string);
    expect(startBody).toEqual({ max_duration_seconds: 60 });
    expect(fetchMock.mock.calls[2]?.[0]).toContain("browser/recordings/recording-1");
    expect(fetchMock.mock.calls[3]?.[0]).toContain("browser/recordings/stop");
  });

  it("downloads a recording as mp4 named after the served content type", async () => {
    const { box, fetchMock } = await createTestBox();
    const bytes = new TextEncoder().encode("mp4-bytes");
    fetchMock.mockResolvedValueOnce(mockVideoResponse("video/mp4", bytes));

    // Default path is cwd-relative; run in a temp cwd so the real stream/rename
    // don't touch the repo.
    const dir = await realFs.mkdtemp(join(tmpdir(), "box-sdk-test-"));
    const cwd = process.cwd();
    process.chdir(dir);
    renameMock.mockImplementation((from: string, to: string) => realFs.rename(from, to));
    try {
      const dest = await box.browser.recordings.download("recording-1");

      expect(dest).toBe("./box-recording-recording-1.mp4");
      expect(await realFs.readFile(join(dir, "box-recording-recording-1.mp4"), "utf8")).toBe(
        "mp4-bytes",
      );
    } finally {
      process.chdir(cwd);
      await realFs.rm(dir, { recursive: true, force: true });
    }
    expect(fetchMock.mock.calls[1]?.[0]).toContain(
      "/v2/box/box-123/browser/recordings/recording-1/download",
    );
  });

  it("downloads a legacy recording as raw MPEG-TS", async () => {
    const { box, fetchMock } = await createTestBox();
    const bytes = new TextEncoder().encode("ts-bytes");
    fetchMock.mockResolvedValueOnce(mockVideoResponse("video/mp2t", bytes));

    const dir = await realFs.mkdtemp(join(tmpdir(), "box-sdk-test-"));
    const cwd = process.cwd();
    process.chdir(dir);
    renameMock.mockImplementation((from: string, to: string) => realFs.rename(from, to));
    try {
      const dest = await box.browser.recordings.download("recording-1");

      expect(dest).toBe("./box-recording-recording-1.ts");
      expect(await realFs.readFile(join(dir, "box-recording-recording-1.ts"), "utf8")).toBe(
        "ts-bytes",
      );
    } finally {
      process.chdir(cwd);
      await realFs.rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a download whose content type is neither MP4 nor MPEG-TS", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(
      mockVideoResponse("text/html", new TextEncoder().encode("<html>nope</html>")),
    );

    await expect(box.browser.recordings.download("recording-1")).rejects.toThrow(
      "Unexpected recording content type: text/html",
    );
    // Rejected before any file is opened.
    expect(renameMock).not.toHaveBeenCalled();
  });

  it("throws when the response body is not streamable", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce({
      ...mockResponse({}),
      headers: new Headers({ "content-type": "video/mp4" }),
      body: null,
    } as Response);

    await expect(box.browser.recordings.download("recording-1")).rejects.toThrow(
      "Streaming not supported",
    );
  });

  it("surfaces the backend error body when a download request fails", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(
      mockResponse({ error: "recording is not ready for download" }, 409),
    );

    await expect(box.browser.recordings.download("recording-1")).rejects.toThrow(
      "recording is not ready for download",
    );
  });

  it("downloads a recording to an explicit path, creating parent directories", async () => {
    const { box, fetchMock } = await createTestBox();
    const bytes = new TextEncoder().encode("mp4-bytes");
    fetchMock.mockResolvedValueOnce(mockVideoResponse("video/mp4", bytes));

    const dir = await realFs.mkdtemp(join(tmpdir(), "box-sdk-test-"));
    const dest = join(dir, "recordings", "nested", "demo.mp4");
    mkdirMock.mockImplementation((p: string, opts: object) => realFs.mkdir(p, opts));
    renameMock.mockImplementation((from: string, to: string) => realFs.rename(from, to));

    const saved = await box.browser.recordings.download("recording-1", { path: dest });

    expect(saved).toBe(dest);
    expect(mkdirMock).toHaveBeenCalledWith(join(dir, "recordings", "nested"), { recursive: true });
    expect(await realFs.readFile(dest, "utf8")).toBe("mp4-bytes");
    await realFs.rm(dir, { recursive: true, force: true });
  });

  it("streams a download body to disk and tolerates content-type parameters", async () => {
    const { box, fetchMock } = await createTestBox();
    const dir = await realFs.mkdtemp(join(tmpdir(), "box-sdk-test-"));
    const dest = join(dir, "streamed.mp4");
    const bytes = new TextEncoder().encode("streamed-mp4-bytes");
    fetchMock.mockResolvedValueOnce({
      ...mockResponse({}),
      headers: new Headers({ "content-type": "Video/MP4; some=param" }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    } as unknown as Response);

    // The temp file is a real sibling of dest; move it onto dest as the code does.
    renameMock.mockImplementationOnce((from: string, to: string) => realFs.rename(from, to));

    const saved = await box.browser.recordings.download("recording-1", { path: dest });

    expect(saved).toBe(dest);
    expect(await realFs.readFile(dest, "utf8")).toBe("streamed-mp4-bytes");
    // Streamed, not buffered: the whole-body fallback never fired for this file.
    expect(writeFileMock).not.toHaveBeenCalledWith(dest, expect.anything());
    // Renamed from a sibling temp file, never written to dest directly.
    expect(renameMock.mock.calls[0]?.[0]).toMatch(/\.tmp$/);
    expect(renameMock.mock.calls[0]?.[1]).toBe(dest);
    await realFs.rm(dir, { recursive: true, force: true });
  });

  it("removes only the temp file, preserving an existing dest, when a stream fails", async () => {
    const { box, fetchMock } = await createTestBox();
    const dir = await realFs.mkdtemp(join(tmpdir(), "box-sdk-test-"));
    const dest = join(dir, "partial.mp4");
    // A prior good download exists at dest; a failed download must not destroy it.
    await realFs.writeFile(dest, "existing-recording");
    fetchMock.mockResolvedValueOnce({
      ...mockResponse({}),
      headers: new Headers({ "content-type": "video/mp4" }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("partial"));
          controller.error(new Error("connection reset"));
        },
      }),
    } as unknown as Response);

    await expect(box.browser.recordings.download("recording-1", { path: dest })).rejects.toThrow(
      "Failed to save recording recording-1",
    );
    // Only the sibling temp file is unlinked; dest itself is never touched.
    expect(unlinkMock.mock.calls[0]?.[0]).toMatch(/\.tmp$/);
    expect(unlinkMock).not.toHaveBeenCalledWith(dest);
    expect(await realFs.readFile(dest, "utf8")).toBe("existing-recording");
    await realFs.rm(dir, { recursive: true, force: true });
  });

  it("does not stop a newer recording from a stale handle", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock
      .mockResolvedValueOnce(
        mockResponse({
          id: "recording-1",
          box_id: "box-123",
          status: "recording",
          started_at: 1000,
        }),
      )
      .mockResolvedValueOnce(
        mockResponse({
          id: "recording-1",
          box_id: "box-123",
          status: "completed",
          started_at: 1000,
          ended_at: 4000,
          stopped_reason: "idle",
        }),
      );

    const handle = await box.browser.recordings.start();
    const recording = await handle.stop();

    expect(recording.status).toBe("completed");
    expect(recording.stoppedReason).toBe("idle");
    // Only get-box, start, and the status check — never the box-wide stop.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("/stop"))).toBe(true);
  });

  it("paginates recordings.list and fetches a single recording", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock
      .mockResolvedValueOnce(
        mockResponse({
          recordings: [{ id: "rec-1", box_id: "box-123", status: "completed", started_at: 1 }],
          next_cursor: "cursor-2",
        }),
      )
      .mockResolvedValueOnce(
        mockResponse({
          recordings: [{ id: "rec-2", box_id: "box-123", status: "deleted", started_at: 2 }],
        }),
      )
      .mockResolvedValueOnce(
        mockResponse({ id: "rec-2", box_id: "box-123", status: "deleted", started_at: 2 }),
      );

    const recordings = await box.browser.recordings.list();
    const single = await box.browser.recordings.get("rec-2");

    expect(recordings.map((r) => r.id)).toEqual(["rec-1", "rec-2"]);
    expect(single.status).toBe("deleted");
    expect(fetchMock.mock.calls[1]?.[0]).toContain("browser/recordings?limit=100");
    expect(fetchMock.mock.calls[2]?.[0]).toContain("cursor=cursor-2");
    expect(fetchMock.mock.calls[3]?.[0]).toContain("browser/recordings/rec-2");
  });

  it("navigates with goto, lists tabs, addresses tabs by id, and closes them", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock
      .mockResolvedValueOnce(
        mockResponse({ title: "Pricing", url: "https://upstash.com/pricing", text: "Pricing" }),
      )
      .mockResolvedValueOnce(
        mockResponse({
          tabs: [
            { id: "tab-1", url: "https://upstash.com/pricing", title: "Pricing" },
            { id: "tab-2", url: "about:blank" },
          ],
        }),
      )
      .mockResolvedValueOnce(mockResponse({ ok: true }));

    const tab = box.browser.getTab("tab-1");
    const content = await tab.goto("https://upstash.com/pricing");
    const tabs = await box.browser.listTabs();
    await tabs[1]!.close();

    expect(content.title).toBe("Pricing");
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({
      url: "https://upstash.com/pricing",
      tab: "tab-1",
    });
    expect(tabs.map((t) => t.id)).toEqual(["tab-1", "tab-2"]);
    expect(fetchMock.mock.calls[3]?.[0]).toContain("browser/tabs/tab-2");
    expect(fetchMock.mock.calls[3]?.[1]?.method).toBe("DELETE");
  });

  it("observes actionable elements on the selected tab", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        elements: [
          {
            description: "Sign in button",
            selector: "xpath=/html/body/button",
            method: "click",
            arguments: [],
          },
        ],
      }),
    );

    const result = await box.browser.getTab("tab-1").observe("the sign in button");

    // method/arguments pass through so the element can be replayed via act(action).
    expect(result.elements).toEqual([
      {
        description: "Sign in button",
        selector: "xpath=/html/body/button",
        method: "click",
        arguments: [],
      },
    ]);
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({
      instruction: "the sign in button",
      tab: "tab-1",
    });
  });

  it("sends timeout: 0 through to disable the navigation deadline", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(mockResponse({ id: "tab-1", url: "about:blank" }));

    await box.browser.tab.create("about:blank", { timeout: 0 });

    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({
      url: "about:blank",
      timeout: 0,
    });
  });

  it("rejects non-Zod schemas for extract", async () => {
    const { box } = await createTestBox();
    const tab = box.browser.getTab("tab-1");
    const fake = { parse: (d: unknown) => d };

    await expect(tab.extract("get data", fake)).rejects.toThrow(
      "extract requires a Zod object schema",
    );
  });

  it("throws when connect or screencast responses lack a URL", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock
      .mockResolvedValueOnce(mockResponse({}))
      .mockResolvedValueOnce(mockResponse({ token: "view-token" }));

    await expect(box.browser.cdpUrl()).rejects.toThrow("Browser connect did not return a CDP URL");
    await expect(box.browser.getTab("tab-1").liveViewUrl()).rejects.toThrow(
      "Browser screencast did not return a URL",
    );
  });

  it("decodes screenshots without Buffer (edge runtime path)", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(mockResponse({ data: "AQID" }));

    vi.stubGlobal("Buffer", undefined);
    try {
      const png = await box.browser.getTab("tab-1").screenshot();
      expect(png).toEqual(new Uint8Array([1, 2, 3]));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
