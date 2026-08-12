import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod/v4";
import type {
  BrowserRecording,
  BrowserRecordingHandle,
  BrowserRecordingMarker,
  BrowserRecordingOptions,
} from "../index.js";
import { createTestBox, mockResponse } from "./helpers.js";

type PublicRecordingTypes = [
  BrowserRecording,
  BrowserRecordingHandle,
  BrowserRecordingMarker,
  BrowserRecordingOptions,
];

describe("Box browser operations", () => {
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

  it("runs a multi-step task with schema-validated structured output", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock
      .mockResolvedValueOnce(mockResponse({ id: "tab-2", url: "https://linkedin.com" }))
      .mockResolvedValueOnce(
        mockResponse({
          result: "Found five people",
          data: {
            people: Array.from({ length: 5 }, (_, index) => ({
              name: `Founder ${index + 1}`,
              headline: "AI founder in Berlin",
              profileUrl: `https://linkedin.com/in/founder-${index + 1}`,
            })),
          },
          completed: true,
          steps: [{ step: 1, action: "search", url: "https://linkedin.com/search" }],
          step_count: 1,
          input_tokens: 100,
          output_tokens: 25,
        }),
      );

    const tab = await box.browser.tab.create("https://linkedin.com");
    const result = await tab.run("Find five AI founders in Berlin", {
      schema: z.object({
        people: z
          .array(
            z.object({
              name: z.string(),
              headline: z.string(),
              profileUrl: z.string(),
            }),
          )
          .length(5),
      }),
      maxSteps: 25,
    });

    const typedPeople: Array<{ name: string; headline: string; profileUrl: string }> =
      result.data.people;
    expect(typedPeople).toHaveLength(5);
    expect(result.completed).toBe(true);

    const body = JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string);
    expect(body).toMatchObject({
      prompt: "Find five AI founders in Berlin",
      tab: "tab-2",
      max_steps: 25,
      schema: {
        type: "object",
        properties: {
          people: { type: "array", minItems: 5, maxItems: 5 },
        },
      },
    });
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

  it("runs without a schema and supports the deprecated options form", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock
      .mockResolvedValueOnce(
        mockResponse({ result: "done", completed: true, steps: [], step_count: 3 }),
      )
      .mockResolvedValueOnce(
        mockResponse({ result: "done again", completed: false, steps: [], step_count: 15 }),
      );

    const tab = box.browser.getTab("tab-1");
    const plain = await tab.run("Do the thing");
    const deprecated = await tab.run({ prompt: "Do the thing again", maxSteps: 20 });

    expect(plain.data).toBeUndefined();
    expect(plain.completed).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string)).toEqual({
      prompt: "Do the thing",
      tab: "tab-1",
    });
    expect(deprecated.result).toBe("done again");
    expect(JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string)).toEqual({
      prompt: "Do the thing again",
      tab: "tab-1",
      max_steps: 20,
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

  it("rejects non-Zod schemas for extract and run", async () => {
    const { box } = await createTestBox();
    const tab = box.browser.getTab("tab-1");
    const fake = { parse: (d: unknown) => d };

    await expect(tab.extract("get data", fake)).rejects.toThrow(
      "extract requires a Zod object schema",
    );
    await expect(tab.run("go", { schema: fake })).rejects.toThrow(
      "run requires a Zod object schema",
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
