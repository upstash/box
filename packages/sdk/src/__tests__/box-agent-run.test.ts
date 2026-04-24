import { describe, it, expect, vi, afterEach } from "vitest";
import { z } from "zod/v3";
import { Agent } from "../types.js";
import type { Chunk } from "../types.js";
import { mockSSEResponse, mockResponse, createTestBox, mockSSEResponseChunked } from "./helpers.js";

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
    expect(run.result).toBe("Hello world");
    expect(run.status).toBe("completed");
    expect(run.cost.inputTokens).toBe(10);
    expect(run.cost.outputTokens).toBe(20);
  });

  it("calls onToolUse callback", async () => {
    const { box, fetchMock } = await createTestBox();
    const tools: Array<{ toolCallId?: string; name: string; input: Record<string, unknown> }> = [];

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "tool", data: { id: "tool-1", name: "Read", input: { path: "/test" } } },
        { event: "done", data: {} },
      ]),
    );

    await box.agent.run({
      prompt: "test",
      onToolUse: (tool) => tools.push(tool),
    });

    expect(tools).toHaveLength(1);
    expect(tools[0]!.toolCallId).toBe("tool-1");
    expect(tools[0]!.name).toBe("Read");
  });

  it("calls onToolResult callback", async () => {
    const { box, fetchMock } = await createTestBox();
    const results: Array<{ toolCallId?: string; output: unknown }> = [];

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "tool_result", data: { toolCallId: "tool-1", output: { ok: true } } },
        { event: "done", data: {} },
      ]),
    );

    await box.agent.run({
      prompt: "test",
      onToolResult: (result) => results.push(result),
    });

    expect(results).toEqual([{ toolCallId: "tool-1", output: { ok: true } }]);
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

    const schema = z.object({
      name: z.string(),
      count: z.number(),
    });

    const run = await box.agent.run({
      prompt: "test",
      responseSchema: schema,
    });

    const result = run.result;
    expect(result).toEqual({ name: "test", count: 42 });
  });

  it("sends json_schema in request body when responseSchema is provided", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "done", data: { output: '{"name":"test","count":42}' } },
      ]),
    );

    const schema = z.object({
      name: z.string(),
      count: z.number(),
    });

    await box.agent.run({ prompt: "analyze this", responseSchema: schema });

    const [, runCall] = fetchMock.mock.calls;
    const body = JSON.parse(runCall[1].body as string);
    expect(body.prompt).toBe("analyze this");
    expect(body.json_schema).toEqual({
      type: "object",
      properties: {
        name: { type: "string" },
        count: { type: "number" },
      },
      required: ["name", "count"],
      additionalProperties: false,
    });
  });

  it("does not modify prompt when responseSchema is provided", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "done", data: { output: '{"name":"test"}' } },
      ]),
    );

    const schema = z.object({
      name: z.string(),
    });

    await box.agent.run({ prompt: "do something", responseSchema: schema });

    const [, runCall] = fetchMock.mock.calls;
    const body = JSON.parse(runCall[1].body as string);
    expect(body.prompt).toBe("do something");
    expect(body.prompt).not.toContain("Respond with ONLY a valid JSON");
  });

  it("does not send json_schema when no responseSchema", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "done", data: { output: "hello" } },
      ]),
    );

    await box.agent.run({ prompt: "say hello" });

    const [, runCall] = fetchMock.mock.calls;
    const body = JSON.parse(runCall[1].body as string);
    expect(body.json_schema).toBeUndefined();
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

    const schema = z.object({ value: z.number() });

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
    expect(run.result).toBe("final output");
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

  it("sends webhook in request body and returns accepted response", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(mockResponse({ status: "accepted", box_id: "box-123" }));

    const run = await box.agent.run({
      prompt: "do something",
      webhook: {
        url: "https://example.com/hook",
        headers: { "X-Custom": "value" },
      },
    });

    expect(run.id).toEqual(expect.any(String));

    const [, runCall] = fetchMock.mock.calls;
    const body = JSON.parse(runCall[1].body as string);
    expect(body.prompt).toBe("do something");
    expect(body.webhook).toEqual({
      url: "https://example.com/hook",
      headers: { "X-Custom": "value" },
    });
  });

  it("sends webhook with json_schema when both responseSchema and webhook are provided", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(mockResponse({ status: "accepted", box_id: "box-123" }));

    const schema = z.object({
      name: z.string(),
      count: z.number(),
    });

    const run = await box.agent.run({
      prompt: "analyze this",
      responseSchema: schema,
      webhook: { url: "https://example.com/hook" },
    });

    expect(run.id).toEqual(expect.any(String));

    const [, runCall] = fetchMock.mock.calls;
    const body = JSON.parse(runCall[1].body as string);
    expect(body.prompt).toBe("analyze this");
    expect(body.webhook).toEqual({ url: "https://example.com/hook" });
    expect(body.json_schema).toEqual({
      type: "object",
      properties: {
        name: { type: "string" },
        count: { type: "number" },
      },
      required: ["name", "count"],
      additionalProperties: false,
    });
  });

  it("does not send webhook in request body when no webhook provided", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "done", data: { output: "hello" } },
      ]),
    );

    await box.agent.run({ prompt: "say hello" });

    const [, runCall] = fetchMock.mock.calls;
    const body = JSON.parse(runCall[1].body as string);
    expect(body.webhook).toBeUndefined();
  });

  it("throws on non-OK webhook response", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(mockResponse({ error: "bad request" }, 400));

    await expect(
      box.agent.run({
        prompt: "test",
        webhook: { url: "https://example.com/hook" },
      }),
    ).rejects.toThrow("bad request");
  });

  it("sends ClaudeCode agent_options in request body", async () => {
    const { box, fetchMock } = await createTestBox<Agent.ClaudeCode>();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "done", data: { output: "ok" } },
      ]),
    );

    await box.agent.run({
      prompt: "test",
      options: {
        maxTurns: 5,
        effort: "max",
        thinking: { type: "enabled", budgetTokens: 16000 },
      },
    });

    const [, runCall] = fetchMock.mock.calls;
    const body = JSON.parse(runCall[1].body as string);
    expect(body.agent_options).toEqual({
      maxTurns: 5,
      effort: "max",
      thinking: { type: "enabled", budgetTokens: 16000 },
    });
  });

  it("sends Codex agent_options in request body", async () => {
    const { box, fetchMock } = await createTestBox<Agent.Codex>({ agent: Agent.Codex });

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "done", data: { output: "ok" } },
      ]),
    );

    await box.agent.run({
      prompt: "test",
      options: {
        modelReasoningEffort: "high",
        personality: "pragmatic",
        webSearch: true,
      },
    });

    const [, runCall] = fetchMock.mock.calls;
    const body = JSON.parse(runCall[1].body as string);
    expect(body.agent_options).toEqual({
      model_reasoning_effort: "high",
      personality: "pragmatic",
      web_search: true,
    });
  });

  it("sends OpenCode agent_options in request body", async () => {
    const { box, fetchMock } = await createTestBox<Agent.OpenCode>();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "done", data: { output: "ok" } },
      ]),
    );

    await box.agent.run({
      prompt: "test",
      options: {
        reasoningEffort: "high",
        textVerbosity: "low",
        reasoningSummary: "concise",
      },
    });

    const [, runCall] = fetchMock.mock.calls;
    const body = JSON.parse(runCall[1].body as string);
    expect(body.agent_options).toEqual({
      reasoningEffort: "high",
      textVerbosity: "low",
      reasoningSummary: "concise",
    });
  });

  it("does not send agent_options when not provided", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "done", data: { output: "ok" } },
      ]),
    );

    await box.agent.run({ prompt: "test" });

    const [, runCall] = fetchMock.mock.calls;
    const body = JSON.parse(runCall[1].body as string);
    expect(body.agent_options).toBeUndefined();
  });

  it("sends agent_options in webhook run", async () => {
    const { box, fetchMock } = await createTestBox<Agent.ClaudeCode>();

    fetchMock.mockResolvedValueOnce(mockResponse({ status: "accepted", box_id: "box-123" }));

    await box.agent.run({
      prompt: "test",
      options: { maxTurns: 3 },
      webhook: { url: "https://example.com/hook" },
    });

    const [, runCall] = fetchMock.mock.calls;
    const body = JSON.parse(runCall[1].body as string);
    expect(body.agent_options).toEqual({ maxTurns: 3 });
  });
});

describe("box.agent.stream", () => {
  afterEach(() => vi.restoreAllMocks());

  it("yields Chunk objects", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "text", data: { text: "Hello " } },
        { event: "text", data: { text: "world" } },
        { event: "done", data: {} },
      ]),
    );

    const run = await box.agent.stream({ prompt: "say hello" });
    const chunks: Chunk[] = [];
    for await (const chunk of run) {
      chunks.push(chunk);
    }
    const textChunks = chunks.filter(
      (c): c is Extract<Chunk, { type: "text-delta" }> => c.type === "text-delta",
    );
    expect(textChunks.map((c) => c.text)).toEqual(["Hello ", "world"]);
    expect(chunks[0]!.type).toBe("start");
    expect(chunks[chunks.length - 1]!.type).toBe("finish");
    expect(run.status).toBe("completed");
    expect(run.result).toBe("Hello world");
  });

  it("yields tool-call chunks and calls onToolUse", async () => {
    const { box, fetchMock } = await createTestBox();
    const tools: Array<{ toolCallId?: string; name: string; input: Record<string, unknown> }> = [];

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "tool", data: { id: "tool-2", name: "Write", input: { path: "/x" } } },
        { event: "text", data: { text: "done" } },
        { event: "done", data: {} },
      ]),
    );

    const run = await box.agent.stream({
      prompt: "test",
      onToolUse: (tool) => tools.push(tool),
    });
    const chunks: Chunk[] = [];
    for await (const chunk of run) {
      chunks.push(chunk);
    }

    expect(tools).toHaveLength(1);
    expect(tools[0]!.toolCallId).toBe("tool-2");
    expect(tools[0]!.name).toBe("Write");
    const toolChunks = chunks.filter((c) => c.type === "tool-call");
    expect(toolChunks).toHaveLength(1);
    expect(toolChunks[0]).toEqual({
      type: "tool-call",
      toolCallId: "tool-2",
      toolName: "Write",
      input: { path: "/x" },
    });
    const textChunks = chunks.filter(
      (c): c is Extract<Chunk, { type: "text-delta" }> => c.type === "text-delta",
    );
    expect(textChunks.map((c) => c.text)).toEqual(["done"]);
  });

  it("yields tool-result chunks and calls onToolResult", async () => {
    const { box, fetchMock } = await createTestBox();
    const results: Array<{ toolCallId?: string; output: unknown }> = [];

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "tool_result", data: { tool_use_id: "tool-3", output: "ok" } },
        { event: "done", data: {} },
      ]),
    );

    const run = await box.agent.stream({
      prompt: "test",
      onToolResult: (result) => results.push(result),
    });
    const chunks: Chunk[] = [];
    for await (const chunk of run) {
      chunks.push(chunk);
    }

    expect(results).toEqual([{ toolCallId: "tool-3", output: "ok" }]);
    expect(chunks).toContainEqual({
      type: "tool-result",
      toolCallId: "tool-3",
      output: "ok",
    });
  });

  it("prefers explicit tool call identifiers over generic ids", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        {
          event: "tool",
          data: {
            id: "event-id",
            tool_use_id: "tool-use-id",
            name: "Read",
            input: { path: "/x" },
          },
        },
        {
          event: "tool_result",
          data: {
            id: "result-event-id",
            toolCallId: "tool-call-id",
            output: "ok",
          },
        },
        { event: "done", data: {} },
      ]),
    );

    const run = await box.agent.stream({ prompt: "test" });
    const chunks: Chunk[] = [];
    for await (const chunk of run) {
      chunks.push(chunk);
    }

    expect(chunks).toContainEqual({
      type: "tool-call",
      toolCallId: "tool-use-id",
      toolName: "Read",
      input: { path: "/x" },
    });
    expect(chunks).toContainEqual({
      type: "tool-result",
      toolCallId: "tool-call-id",
      output: "ok",
    });
  });

  it("yields all chunk types in order", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "text", data: { text: "Hello " } },
        { event: "thinking", data: { text: "trace" } },
        { event: "tool", data: { toolCallId: "tool-4", name: "Write", input: { path: "/x" } } },
        { event: "tool_result", data: { tool_use_id: "tool-4", output: "done" } },
        {
          event: "done",
          data: { output: "Hello world", input_tokens: 7, output_tokens: 9, session_id: "s1" },
        },
        { event: "stats", data: { cpu_ns: 111, memory_peak_bytes: 222 } },
      ]),
    );

    const run = await box.agent.stream({ prompt: "test" });
    const chunks: Chunk[] = [];
    for await (const chunk of run) {
      chunks.push(chunk);
    }

    expect(chunks.map((c) => c.type)).toEqual([
      "start",
      "text-delta",
      "reasoning",
      "tool-call",
      "tool-result",
      "finish",
      "stats",
    ]);
    expect(run.result).toBe("Hello world");
  });

  it("throws on missing prompt", async () => {
    const { box } = await createTestBox();
    await expect(box.agent.stream({ prompt: "" })).rejects.toThrow("prompt is required");
  });

  it("throws on stream error event", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "error", data: { error: "something broke" } },
      ]),
    );

    const run = await box.agent.stream({ prompt: "test" });
    const chunks: Chunk[] = [];
    await expect(async () => {
      for await (const chunk of run) {
        chunks.push(chunk);
      }
    }).rejects.toThrow("something broke");
    // The start chunk should have been yielded before the error
    expect(chunks[0]!.type).toBe("start");
  });

  it("throws on non-OK response", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(mockResponse({ error: "server error" }, 500));

    await expect(box.agent.stream({ prompt: "test" })).rejects.toThrow("server error");
  });

  it("sets status to detached when consumer breaks early", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponseChunked([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "text", data: { text: "Hello " } },
        { event: "text", data: { text: "world" } },
        { event: "done", data: { output: "Hello world" } },
      ]),
    );

    const run = await box.agent.stream({ prompt: "test" });
    for await (const chunk of run) {
      if (chunk.type === "text-delta") break; // early exit after first text
    }

    expect(run.status).toBe("detached");
    expect(run.result).toBe("Hello"); // trimmed by the iterator
    expect(run.cost.computeMs).toBeGreaterThanOrEqual(0);
  });

  it("sets status to failed on stream error and preserves partial output", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponseChunked([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "text", data: { text: "partial" } },
        { event: "error", data: { error: "something broke" } },
      ]),
    );

    const run = await box.agent.stream({ prompt: "test" });
    const chunks: Chunk[] = [];
    await expect(async () => {
      for await (const chunk of run) {
        chunks.push(chunk);
      }
    }).rejects.toThrow("something broke");

    expect(run.status).toBe("failed");
    expect(run.result).toBe("partial");
    expect(run.cost.computeMs).toBeGreaterThanOrEqual(0);
  });

  it("sends agent_options in stream request body (OpenCode)", async () => {
    const { box, fetchMock } = await createTestBox<Agent.OpenCode>();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "done", data: { output: "ok" } },
      ]),
    );

    const run = await box.agent.stream({
      prompt: "test",
      options: { reasoningEffort: "high", textVerbosity: "low" },
    });
    for await (const _ of run) {
      // consume
    }

    const [, runCall] = fetchMock.mock.calls;
    const body = JSON.parse(runCall[1].body as string);
    expect(body.agent_options).toEqual({ reasoningEffort: "high", textVerbosity: "low" });
  });

  it("sends agent_options in stream request body (Codex)", async () => {
    const { box, fetchMock } = await createTestBox<Agent.Codex>({ agent: Agent.Codex });

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "done", data: { output: "ok" } },
      ]),
    );

    const run = await box.agent.stream({
      prompt: "test",
      options: { modelReasoningEffort: "medium", personality: "friendly" },
    });
    for await (const _ of run) {
      // consume
    }

    const [, runCall] = fetchMock.mock.calls;
    const body = JSON.parse(runCall[1].body as string);
    expect(body.agent_options).toEqual({
      model_reasoning_effort: "medium",
      personality: "friendly",
    });
  });
});
