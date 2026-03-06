import { describe, it, expect, vi, afterEach } from "vitest";
import { mockResponse, createTestBox, TEST_CONFIG } from "./helpers.js";
import type { ExecStreamChunk } from "../types.js";

function mockExecStreamResponse(
  text: string,
  exitData: { exit_code: number; cpu_ns: number },
  status = 200,
): Response {
  const exitEvent = `event: exit\ndata: ${JSON.stringify(exitData)}\n\n`;
  const raw = text + exitEvent;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(raw));
      controller.close();
    },
  });

  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers({ "content-type": "text/event-stream" }),
    json: () => Promise.reject(new Error("stream response")),
    text: () => Promise.resolve(raw),
    body: stream,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    clone: () => mockExecStreamResponse(text, exitData, status),
    redirected: false,
    type: "basic" as ResponseType,
    url: "",
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response;
}

function mockExecStreamErrorResponse(errorMessage: string): Response {
  const raw = `event: error\ndata: ${JSON.stringify({ error: errorMessage })}\n\n`;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(raw));
      controller.close();
    },
  });

  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers({ "content-type": "text/event-stream" }),
    json: () => Promise.reject(new Error("stream response")),
    text: () => Promise.resolve(raw),
    body: stream,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    clone: () => mockExecStreamErrorResponse(errorMessage),
    redirected: false,
    type: "basic" as ResponseType,
    url: "",
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response;
}

async function collect(gen: AsyncGenerator<ExecStreamChunk>): Promise<ExecStreamChunk[]> {
  const chunks: ExecStreamChunk[] = [];
  for await (const chunk of gen) {
    chunks.push(chunk);
  }
  return chunks;
}

describe("exec.stream", () => {
  afterEach(() => vi.restoreAllMocks());

  it("yields output chunks then exit", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(
      mockExecStreamResponse("hello world\n", { exit_code: 0, cpu_ns: 24562000 }),
    );

    const chunks = await collect(box.exec.stream("echo hello world"));

    expect(chunks.length).toBe(2);
    expect(chunks[0]).toEqual({ type: "output", data: "hello world\n" });
    expect(chunks[1]).toEqual({ type: "exit", exitCode: 0, cpuNs: 24562000 });
  });

  it("sends correct URL and body", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(mockExecStreamResponse("ok\n", { exit_code: 0, cpu_ns: 100 }));

    await collect(box.exec.stream("ls -la"));

    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toContain("/v2/box/box-123/exec-stream");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body.command).toEqual(["sh", "-c", "ls -la"]);
  });

  it("includes folder when cwd is set", async () => {
    const { box, fetchMock } = await createTestBox();
    // cd into a subdirectory
    fetchMock.mockResolvedValueOnce(
      mockResponse({ exit_code: 0, output: "/workspace/home/mydir" }),
    );
    await box.cd("mydir");

    fetchMock.mockResolvedValueOnce(mockExecStreamResponse("ok\n", { exit_code: 0, cpu_ns: 0 }));

    await collect(box.exec.stream("pwd"));

    const [, init] = fetchMock.mock.calls[2]!;
    const body = JSON.parse(init?.body as string);
    expect(body.folder).toBe("mydir");
  });

  it("handles non-zero exit code", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(
      mockExecStreamResponse("not found\n", { exit_code: 127, cpu_ns: 500 }),
    );

    const chunks = await collect(box.exec.stream("badcommand"));
    const exit = chunks.find((c) => c.type === "exit");
    expect(exit).toEqual({ type: "exit", exitCode: 127, cpuNs: 500 });
  });

  it("throws on non-OK response", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(mockResponse({ error: "not found" }, 404));

    await expect(collect(box.exec.stream("echo hi"))).rejects.toThrow("not found");
  });

  it("throws on SSE error event", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(mockExecStreamErrorResponse("failed to start stream"));

    await expect(collect(box.exec.stream("echo hi"))).rejects.toThrow("failed to start stream");
  });
});

describe("exec.streamCode", () => {
  afterEach(() => vi.restoreAllMocks());

  it("yields output chunks then exit", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(
      mockExecStreamResponse('{"sum":3}\n', { exit_code: 0, cpu_ns: 1000 }),
    );

    const chunks = await collect(
      box.exec.streamCode({ code: "console.log(JSON.stringify({sum:1+2}))", lang: "js" }),
    );

    expect(chunks.length).toBe(2);
    expect(chunks[0]).toEqual({ type: "output", data: '{"sum":3}\n' });
    expect(chunks[1]).toEqual({ type: "exit", exitCode: 0, cpuNs: 1000 });
  });

  it("sends correct URL and body", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(mockExecStreamResponse("ok\n", { exit_code: 0, cpu_ns: 0 }));

    await collect(box.exec.streamCode({ code: "print('hi')", lang: "python" }));

    const [url, init] = fetchMock.mock.calls[1]!;
    expect(url).toContain("/v2/box/box-123/code-stream");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(init?.body as string);
    expect(body.code).toBe("print('hi')");
    expect(body.language).toBe("python");
  });

  it("passes timeout when provided", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(mockExecStreamResponse("ok\n", { exit_code: 0, cpu_ns: 0 }));

    await collect(box.exec.streamCode({ code: "console.log('ok')", lang: "js", timeout: 5000 }));

    const [, init] = fetchMock.mock.calls[1]!;
    const body = JSON.parse(init?.body as string);
    expect(body.timeout).toBe(5000);
  });

  it("throws on non-OK response", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(mockResponse({ error: "server error" }, 500));

    await expect(collect(box.exec.streamCode({ code: "x", lang: "js" }))).rejects.toThrow(
      "server error",
    );
  });

  it("throws on SSE error event", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(mockExecStreamErrorResponse("failed to start stream"));

    await expect(collect(box.exec.streamCode({ code: "x", lang: "js" }))).rejects.toThrow(
      "failed to start stream",
    );
  });
});
