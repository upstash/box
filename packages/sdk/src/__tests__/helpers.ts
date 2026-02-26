import { vi } from "vitest";
import { Box } from "../client.js";
import type { BoxData } from "../types.js";

export const TEST_CONFIG = {
  apiKey: "test-api-key",
  baseUrl: "https://test.api.example.com",
  agent: { model: "claude/sonnet_4_5", apiKey: "test-agent-key" },
} as const;

export const TEST_BOX_DATA: BoxData = {
  id: "box-123",
  model: "claude/sonnet_4_5",
  runtime: "node",
  status: "running",
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
};

export function mockResponse(body: unknown, status = 200): Response {
  const json = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers({ "content-type": "application/json" }),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(json),
    body: null,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    clone: () => mockResponse(body, status),
    redirected: false,
    type: "basic" as ResponseType,
    url: "",
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response;
}

export function mockSSEResponse(events: Array<{ event: string; data: unknown }>): Response {
  const lines = events
    .map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`)
    .join("");
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(lines));
      controller.close();
    },
  });

  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers({ "content-type": "text/event-stream" }),
    json: () => Promise.reject(new Error("SSE response")),
    text: () => Promise.resolve(lines),
    body: stream,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    clone: () => mockSSEResponse(events),
    redirected: false,
    type: "basic" as ResponseType,
    url: "",
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response;
}

/**
 * Creates a real Box instance by mocking the fetch for Box.get().
 */
export async function createTestBox(
  overrides?: Partial<BoxData>,
): Promise<{ box: Box; fetchMock: ReturnType<typeof vi.fn> }> {
  const data = { ...TEST_BOX_DATA, ...overrides };
  const fetchMock = vi.fn().mockResolvedValueOnce(mockResponse(data));
  vi.stubGlobal("fetch", fetchMock);
  const box = await Box.get(data.id, {
    apiKey: TEST_CONFIG.apiKey,
    baseUrl: TEST_CONFIG.baseUrl,
  });
  return { box, fetchMock };
}

/**
 * Creates a Box instance via Box.get() and clears the mock call history
 * so that test assertions on fetchMock.mock.calls start from index 0.
 */
export async function createAttachedBox(
  overrides?: Partial<BoxData>,
): Promise<{ box: Box; fetchMock: ReturnType<typeof vi.fn> }> {
  const { box, fetchMock } = await createTestBox(overrides);
  // Clear the Box.get() call so tests can assert from calls[0]
  fetchMock.mockClear();
  return { box, fetchMock };
}
