import { vi } from "vitest";
import { Box } from "../client.js";
import { Agent, ClaudeCode } from "../types.js";
import type { BoxData, BoxConfig } from "../types.js";

export const TEST_CONFIG: BoxConfig = {
  apiKey: "test-api-key",
  baseUrl: "https://test.api.example.com",
  agent: { runner: Agent.ClaudeCode, model: ClaudeCode.Sonnet_4_5, apiKey: "test-agent-key" },
};

export const TEST_BOX_DATA: Partial<BoxData> = {
  id: "box-123",
  model: "anthropic/claude-sonnet-4-5",
  runtime: "node",
  status: "running",
  created_at: 1672531200,
  updated_at: 1672531200,
  network_policy: {
    mode: "allow-all",
  },
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
 * Like mockSSEResponse, but enqueues each event as a separate chunk
 * so consumers can break between events (for testing early termination).
 */
export function mockSSEResponseChunked(events: Array<{ event: string; data: unknown }>): Response {
  const encoder = new TextEncoder();
  const lines = events.map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
  const allText = lines.join("");

  const stream = new ReadableStream({
    async start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line));
        // Yield to microtask queue so the consumer can process each chunk
        await new Promise((r) => setTimeout(r, 0));
      }
      controller.close();
    },
  });

  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers({ "content-type": "text/event-stream" }),
    json: () => Promise.reject(new Error("SSE response")),
    text: () => Promise.resolve(allText),
    body: stream,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    clone: () => mockSSEResponseChunked(events),
    redirected: false,
    type: "basic" as ResponseType,
    url: "",
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response;
}

/**
 * Creates a real Box instance by mocking the fetch for Box.get().
 */
export async function createTestBox<TProvider = unknown>(
  overrides?: Partial<BoxData>,
): Promise<{ box: Box<TProvider>; fetchMock: ReturnType<typeof vi.fn> }> {
  const data = { ...TEST_BOX_DATA, ...overrides };
  const fetchMock = vi.fn().mockResolvedValueOnce(mockResponse(data));
  vi.stubGlobal("fetch", fetchMock);
  const box = await Box.get<TProvider>(data.id!, {
    apiKey: TEST_CONFIG.apiKey,
    baseUrl: TEST_CONFIG.baseUrl,
  });
  return { box, fetchMock };
}
