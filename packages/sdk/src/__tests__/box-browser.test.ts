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
          links: [{ t: "More information", h: "https://iana.org/help/example-domains" }],
        }),
      );

    const tab = await box.browser.newTab("https://example.com");
    const content = await tab.content();

    expect(tab.id).toBe("tab-1");
    expect(content.links?.[0]).toEqual({
      t: "More information",
      h: "https://iana.org/help/example-domains",
    });
    expect(fetchMock.mock.calls[2]?.[0]).toContain("browser/content?tab=tab-1");
  });

  it("extracts with a Zod 4 schema", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock
      .mockResolvedValueOnce(mockResponse({ id: "tab-1", url: "https://example.com" }))
      .mockResolvedValueOnce(mockResponse({ data: { heading: "Example Domain" } }));

    const tab = await box.browser.newTab("https://example.com");
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

    const tab = await box.browser.newTab("https://example.com/login");
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
      .mockResolvedValueOnce(
        mockResponse({
          id: "recording-1",
          box_id: "box-123",
          status: "completed",
          started_at: 1000,
          ended_at: 5000,
          duration_ms: 4000,
          size_bytes: 2048,
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
      segmentCount: 2,
      stoppedReason: "max_duration",
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
    expect(fetchMock.mock.calls[2]?.[0]).toContain("browser/recordings/stop");
  });
});
