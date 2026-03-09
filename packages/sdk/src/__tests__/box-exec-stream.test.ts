import { describe, it, expect, vi, afterEach } from "vitest";
import { mockResponse, createTestBox } from "./helpers.js";
import type { StreamRun } from "../client.js";
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

function mockExecStreamResponseChunked(
  textChunks: string[],
  exitData: { exit_code: number; cpu_ns: number },
): Response {
  const encoder = new TextEncoder();
  const exitEvent = `event: exit\ndata: ${JSON.stringify(exitData)}\n\n`;

  const stream = new ReadableStream({
    async start(controller) {
      for (const text of textChunks) {
        controller.enqueue(encoder.encode(text));
        await new Promise((r) => setTimeout(r, 0));
      }
      controller.enqueue(encoder.encode(exitEvent));
      await new Promise((r) => setTimeout(r, 0));
      controller.close();
    },
  });

  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers({ "content-type": "text/event-stream" }),
    json: () => Promise.reject(new Error("stream response")),
    text: () => Promise.resolve(textChunks.join("") + exitEvent),
    body: stream,
    bodyUsed: false,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    blob: () => Promise.resolve(new Blob()),
    formData: () => Promise.resolve(new FormData()),
    clone: () => mockExecStreamResponseChunked(textChunks, exitData),
    redirected: false,
    type: "basic" as ResponseType,
    url: "",
    bytes: () => Promise.resolve(new Uint8Array()),
  } as Response;
}

async function collect(run: StreamRun<string, ExecStreamChunk>): Promise<ExecStreamChunk[]> {
  const chunks: ExecStreamChunk[] = [];
  for await (const chunk of run) {
    chunks.push(chunk);
  }
  return chunks;
}

describe("exec.stream", () => {
  afterEach(() => vi.restoreAllMocks());

  it("yields ExecStreamChunk objects then populates run", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(
      mockExecStreamResponse("hello world\n", { exit_code: 0, cpu_ns: 24562000 }),
    );

    const run = await box.exec.stream("echo hello world");
    const chunks = await collect(run);

    const outputChunks = chunks.filter((c) => c.type === "output");
    expect(outputChunks.length).toBe(1);
    expect(outputChunks[0]!.type === "output" && outputChunks[0]!.data).toBe("hello world\n");
    expect(chunks.some((c) => c.type === "exit")).toBe(true);
    expect(run.status).toBe("completed");
    expect(run.exitCode).toBe(0);
    expect(run.result).toBe("hello world\n");
  });

  it("sends correct URL and body", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(mockExecStreamResponse("ok\n", { exit_code: 0, cpu_ns: 100 }));

    const run = await box.exec.stream("ls -la");
    await collect(run);

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

    const run = await box.exec.stream("pwd");
    await collect(run);

    const [, init] = fetchMock.mock.calls[2]!;
    const body = JSON.parse(init?.body as string);
    expect(body.folder).toBe("mydir");
  });

  it("handles non-zero exit code", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(
      mockExecStreamResponse("not found\n", { exit_code: 127, cpu_ns: 500 }),
    );

    const run = await box.exec.stream("badcommand");
    await collect(run);

    expect(run.exitCode).toBe(127);
    expect(run.status).toBe("failed");
  });

  it("throws on non-OK response", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(mockResponse({ error: "not found" }, 404));

    await expect(box.exec.stream("echo hi")).rejects.toThrow("not found");
  });

  it("throws on SSE error event", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(mockExecStreamErrorResponse("failed to start stream"));

    const run = await box.exec.stream("echo hi");
    await expect(collect(run)).rejects.toThrow("failed to start stream");
  });

  it("sets status to detached when consumer breaks early", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(
      mockExecStreamResponseChunked(["line1\n", "line2\n", "line3\n"], {
        exit_code: 0,
        cpu_ns: 100,
      }),
    );

    const run = await box.exec.stream("echo lines");
    for await (const chunk of run) {
      if (chunk.type === "output") break; // early exit after first output
    }

    expect(run.status).toBe("detached");
    expect(run.result).toBe("line1\n");
    expect(run.cost.computeMs).toBeGreaterThanOrEqual(0);
  });

  it("sets status to failed on error and preserves partial output", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(mockExecStreamErrorResponse("exec failed"));

    const run = await box.exec.stream("bad cmd");
    await expect(collect(run)).rejects.toThrow("exec failed");

    expect(run.status).toBe("failed");
    expect(run.cost.computeMs).toBeGreaterThanOrEqual(0);
  });
});

describe("exec.streamCode", () => {
  afterEach(() => vi.restoreAllMocks());

  it("yields ExecStreamChunk objects then populates run", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(
      mockExecStreamResponse('{"sum":3}\n', { exit_code: 0, cpu_ns: 1000 }),
    );

    const run = await box.exec.streamCode({
      code: "console.log(JSON.stringify({sum:1+2}))",
      lang: "js",
    });
    const chunks = await collect(run);

    const outputChunks = chunks.filter((c) => c.type === "output");
    expect(outputChunks.length).toBe(1);
    expect(outputChunks[0]!.type === "output" && outputChunks[0]!.data).toBe('{"sum":3}\n');
    expect(run.status).toBe("completed");
    expect(run.exitCode).toBe(0);
    expect(run.type).toBe("code");
  });

  it("sends correct URL and body", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(mockExecStreamResponse("ok\n", { exit_code: 0, cpu_ns: 0 }));

    const run = await box.exec.streamCode({ code: "print('hi')", lang: "python" });
    await collect(run);

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

    const run = await box.exec.streamCode({
      code: "console.log('ok')",
      lang: "js",
      timeout: 5000,
    });
    await collect(run);

    const [, init] = fetchMock.mock.calls[1]!;
    const body = JSON.parse(init?.body as string);
    expect(body.timeout).toBe(5000);
  });

  it("throws on non-OK response", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(mockResponse({ error: "server error" }, 500));

    await expect(box.exec.streamCode({ code: "x", lang: "js" })).rejects.toThrow("server error");
  });

  it("throws on SSE error event", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(mockExecStreamErrorResponse("failed to start stream"));

    const run = await box.exec.streamCode({ code: "x", lang: "js" });
    await expect(collect(run)).rejects.toThrow("failed to start stream");
  });

  it("sets status to detached when consumer breaks early", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(
      mockExecStreamResponseChunked(["output1\n", "output2\n"], {
        exit_code: 0,
        cpu_ns: 100,
      }),
    );

    const run = await box.exec.streamCode({ code: "print('hi')", lang: "python" });
    for await (const chunk of run) {
      if (chunk.type === "output") break;
    }

    expect(run.status).toBe("detached");
    expect(run.result).toBe("output1\n");
    expect(run.cost.computeMs).toBeGreaterThanOrEqual(0);
  });

  it("sets status to failed on error and preserves partial output", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(mockExecStreamErrorResponse("code exec failed"));

    const run = await box.exec.streamCode({ code: "x", lang: "js" });
    await expect(collect(run)).rejects.toThrow("code exec failed");

    expect(run.status).toBe("failed");
    expect(run.cost.computeMs).toBeGreaterThanOrEqual(0);
  });
});
