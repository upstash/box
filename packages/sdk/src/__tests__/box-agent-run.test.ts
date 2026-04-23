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
    const tools: Array<{ name: string; input: Record<string, unknown> }> = [];

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "tool", data: { id: "toolu_1", name: "Write", input: { path: "/x" } } },
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
    expect(tools[0]!.name).toBe("Write");
    const toolChunks = chunks.filter(
      (c): c is Extract<Chunk, { type: "tool-call" }> => c.type === "tool-call",
    );
    expect(toolChunks).toHaveLength(1);
    expect(toolChunks[0]!.toolCallId).toBe("toolu_1");
    expect(toolChunks[0]!.toolName).toBe("Write");
    const textChunks = chunks.filter(
      (c): c is Extract<Chunk, { type: "text-delta" }> => c.type === "text-delta",
    );
    expect(textChunks.map((c) => c.text)).toEqual(["done"]);
  });

  it("matches parallel tool-call and tool-result chunks by id", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "tool", data: { id: "toolu_a", name: "Read", input: { path: "/a" } } },
        { event: "tool", data: { id: "toolu_b", name: "Read", input: { path: "/b" } } },
        // Results arrive out of order — must still match by id.
        {
          event: "tool_result",
          data: { tool_use_id: "toolu_b", output: "B contents", is_error: false },
        },
        {
          event: "tool_result",
          data: { tool_use_id: "toolu_a", output: "A contents", is_error: false },
        },
        { event: "done", data: {} },
      ]),
    );

    const run = await box.agent.stream({ prompt: "read both" });
    const chunks: Chunk[] = [];
    for await (const chunk of run) {
      chunks.push(chunk);
    }

    const calls = chunks.filter(
      (c): c is Extract<Chunk, { type: "tool-call" }> => c.type === "tool-call",
    );
    const results = chunks.filter(
      (c): c is Extract<Chunk, { type: "tool-result" }> => c.type === "tool-result",
    );

    expect(calls.map((c) => c.toolCallId)).toEqual(["toolu_a", "toolu_b"]);
    // Out-of-order results must still be matchable by id.
    expect(results.map((r) => r.toolCallId)).toEqual(["toolu_b", "toolu_a"]);

    const resultsById = new Map(results.map((r) => [r.toolCallId, r.output]));
    expect(resultsById.get("toolu_a")).toBe("A contents");
    expect(resultsById.get("toolu_b")).toBe("B contents");
  });

  it("parses tool-result with fallback fields (id instead of tool_use_id, content instead of output)", async () => {
    const { box, fetchMock } = await createTestBox();

    fetchMock.mockResolvedValueOnce(
      mockSSEResponse([
        { event: "run_start", data: { run_id: "r1" } },
        { event: "tool", data: { id: "t1", name: "Bash", input: { command: "ls" } } },
        // Backend uses `id` instead of `tool_use_id`, and `content` instead of `output`
        {
          event: "tool_result",
          data: { id: "t1", content: "file.txt", is_error: true },
        },
        { event: "done", data: {} },
      ]),
    );

    const run = await box.agent.stream({ prompt: "test" });
    const chunks: Chunk[] = [];
    for await (const chunk of run) {
      chunks.push(chunk);
    }

    const results = chunks.filter(
      (c): c is Extract<Chunk, { type: "tool-result" }> => c.type === "tool-result",
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.toolCallId).toBe("t1");
    expect(results[0]!.output).toBe("file.txt");
    expect(results[0]!.isError).toBe(true);
  });

  it("yields all chunk types in order", async () => {
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
