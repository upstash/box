import { describe, it, expect, vi, afterEach } from "vitest";
import { BoxError } from "../client.js";
import type { Chunk } from "../types.js";
import { mockSSEResponse, mockResponse, createTestBox } from "./helpers.js";

describe("box.agent.run", () => {
  afterEach(() => vi.restoreAllMocks());

  it("streams text and completes", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "real-run-1" } },
        { event: "text", data: { text: "Hello " } },
        { event: "text", data: { text: "world" } },
        { event: "done", data: { input_tokens: 10, output_tokens: 20 } },
      ]),
    );

    const run = await box.agent.run({ prompt: "say hello" });
    expect(run.id).toBe("real-run-1");
    expect(await run.result()).toBe("Hello world");
    expect(run._status).toBe("completed");
    expect(run._inputTokens).toBe(10);
    expect(run._outputTokens).toBe(20);
  });

  it("calls onToolUse callback", async () => {
    const { box, fetchMock } = await createTestBox();
    const tools: Array<{ name: string; input: Record<string, unknown> }> = [];

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "tool", data: { name: "Read", input: { path: "/test" } } },
        { event: "done", data: {} },
      ]),
    );

    await box.agent.run({
      prompt: "test",
      onToolUse: (tool) => tools.push(tool),
    });

    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe("Read");
  });

  it("parses structured output with responseSchema", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "text", data: { text: '{"name":"test","count":42}' } },
        { event: "done", data: {} },
      ]),
    );

    const schema = {
      parse: (d: unknown) => d as { name: string; count: number },
      shape: {
        name: { _def: { typeName: "ZodString" } },
        count: { _def: { typeName: "ZodNumber" } },
      },
    };

    const run = await box.agent.run({
      prompt: "test",
      responseSchema: schema,
    });

    const result = await run.result();
    expect(result).toEqual({ name: "test", count: 42 });
  });

  it("extracts JSON from markdown code blocks", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "text", data: { text: '```json\n{"value": 1}\n```' } },
        { event: "done", data: {} },
      ]),
    );

    const schema = { parse: (d: unknown) => d as { value: number } };

    const run = await box.agent.run({
      prompt: "test",
      responseSchema: schema,
    });

    expect(await run.result()).toEqual({ value: 1 });
  });

  it("throws on invalid structured output", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "text", data: { text: "not json at all" } },
        { event: "done", data: {} },
      ]),
    );

    const schema = {
      parse: () => {
        throw new Error("invalid");
      },
    };

    await expect(box.agent.run({ prompt: "test", responseSchema: schema })).rejects.toThrow(
      "Failed to parse structured output",
    );
  });

  it("uses done event output when available", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "text", data: { text: "partial" } },
        { event: "done", data: { output: "final output" } },
      ]),
    );

    const run = await box.agent.run({ prompt: "test" });
    expect(await run.result()).toBe("final output");
  });

  it("throws on missing prompt", async () => {
    const { box } = await createTestBox();
    await expect(box.agent.run({ prompt: "" })).rejects.toThrow("prompt is required");
  });

  it("throws on stream error event", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "error", data: { error: "something broke" } },
      ]),
    );

    await expect(box.agent.run({ prompt: "test" })).rejects.toThrow("something broke");
  });

  it("throws on non-OK response", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(mockResponse({ error: "server error" }, 500));

    await expect(box.agent.run({ prompt: "test" })).rejects.toThrow("server error");
  });
});

describe("box.agent.stream", () => {
  afterEach(() => vi.restoreAllMocks());

  it("yields stream parts", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "text", data: { text: "Hello " } },
        { event: "text", data: { text: "world" } },
        { event: "done", data: {} },
      ]),
    );

    const parts: Chunk[] = [];
    for await (const part of box.agent.stream({ prompt: "say hello" })) {
      parts.push(part);
    }
    expect(parts).toEqual([
      { type: "start", runId: "r1" },
      { type: "text-delta", text: "Hello " },
      { type: "text-delta", text: "world" },
      { type: "finish", output: "", usage: { inputTokens: 0, outputTokens: 0 }, sessionId: "" },
    ]);
  });

  it("calls onToolUse callback", async () => {
    const { box, fetchMock } = await createTestBox();
    const tools: Array<{ name: string; input: Record<string, unknown> }> = [];

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "tool", data: { name: "Write", input: { path: "/x" } } },
        { event: "text", data: { text: "done" } },
        { event: "done", data: {} },
      ]),
    );

    const chunks: Chunk[] = [];
    for await (const chunk of box.agent.stream({
      prompt: "test",
      onToolUse: (tool) => tools.push(tool),
    })) {
      chunks.push(chunk);
    }

    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe("Write");
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "start",
      "tool-call",
      "text-delta",
      "finish",
    ]);
  });

  it("yields typed parts", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "text", data: { text: "Hello " } },
        { event: "thinking", data: { text: "trace" } },
        { event: "tool", data: { name: "Write", input: { path: "/x" } } },
        {
          event: "done",
          data: { output: "Hello world", input_tokens: 7, output_tokens: 9, session_id: "s1" },
        },
        { event: "stats", data: { cpu_ns: 111, memory_peak_bytes: 222 } },
      ]),
    );

    const parts: Chunk[] = [];
    for await (const part of box.agent.stream({ prompt: "test" })) {
      parts.push(part);
    }

    expect(parts).toEqual([
      { type: "start", runId: "r1" },
      { type: "text-delta", text: "Hello " },
      { type: "reasoning", text: "trace" },
      { type: "tool-call", toolName: "Write", input: { path: "/x" } },
      {
        type: "finish",
        output: "Hello world",
        usage: { inputTokens: 7, outputTokens: 9 },
        sessionId: "s1",
      },
      { type: "stats", cpuNs: 111, memoryPeakBytes: 222 },
    ]);
  });

  it("calls onChunk callback with full parts", async () => {
    const { box, fetchMock } = await createTestBox();
    const chunkTypes: string[] = [];

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "tool", data: { name: "Write", input: { path: "/x" } } },
        { event: "text", data: { text: "done" } },
        { event: "done", data: {} },
      ]),
    );

    const chunks: Chunk[] = [];
    for await (const chunk of box.agent.stream({
      prompt: "test",
      onChunk: (part) => chunkTypes.push(part.type),
    })) {
      chunks.push(chunk);
    }

    expect(chunkTypes).toEqual(["start", "tool-call", "text-delta", "finish"]);
    expect(chunks.map((chunk) => chunk.type)).toEqual([
      "start",
      "tool-call",
      "text-delta",
      "finish",
    ]);
  });

  it("throws on missing prompt", async () => {
    const { box } = await createTestBox();
    const gen = box.agent.stream({ prompt: "" });
    await expect(gen.next()).rejects.toThrow("prompt is required");
  });

  it("throws on stream error event", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "error", data: { error: "something broke" } },
      ]),
    );

    const gen = box.agent.stream({ prompt: "test" });
    await expect(gen.next()).resolves.toMatchObject({
      done: false,
      value: { type: "start", runId: "r1" },
    });
    await expect(gen.next()).rejects.toThrow("something broke");
  });

  it("throws on non-OK response", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(mockResponse({ error: "server error" }, 500));

    const gen = box.agent.stream({ prompt: "test" });
    await expect(gen.next()).rejects.toThrow("server error");
  });
});
