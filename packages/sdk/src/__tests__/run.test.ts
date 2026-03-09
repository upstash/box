import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Run, StreamRun, Box } from "../client.js";
import type { Chunk } from "../types.js";
import { mockResponse, createTestBox } from "./helpers.js";

describe("Run", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns status synchronously", async () => {
    const { box } = await createTestBox();
    const run = new Run(box, "agent", "run-1");
    Run._update(run, { status: "completed" });

    expect(run.status).toBe("completed");
  });

  it("returns running status by default", async () => {
    const { box } = await createTestBox();
    const run = new Run(box, "agent", "run-1");

    expect(run.status).toBe("running");
  });

  it("returns result when set", async () => {
    const { box } = await createTestBox();
    const run = new Run<string>(box, "agent", "run-1");
    Run._update(run, { result: "hello world" });

    expect(run.result).toBe("hello world");
  });

  it("returns empty string when result is null", async () => {
    const { box } = await createTestBox();
    const run = new Run<string>(box, "agent", "run-1");

    expect(run.result).toBe("");
  });

  it("returns exitCode", async () => {
    const { box } = await createTestBox();
    const run = new Run(box, "command", "run-1");
    Run._update(run, { exitCode: 0 });

    expect(run.exitCode).toBe(0);
  });

  it("returns null exitCode for agent runs", async () => {
    const { box } = await createTestBox();
    const run = new Run(box, "agent", "run-1");

    expect(run.exitCode).toBeNull();
  });

  it("returns local cost", async () => {
    const { box } = await createTestBox();

    const run = new Run(box, "agent", "run-1");
    Run._update(run, { inputTokens: 100, outputTokens: 50, computeMs: 5000 });

    const cost = run.cost;
    expect(cost.inputTokens).toBe(100);
    expect(cost.outputTokens).toBe(50);
    expect(cost.computeMs).toBe(5000);
    expect(cost.totalUsd).toBe(0);
  });

  it("cancels a run", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(mockResponse({}));

    const run = new Run(box, "agent", "run-1");
    Run._update(run, { abortController: new AbortController() });

    await run.cancel();
    expect(run.status).toBe("cancelled");
  });

  it("fetches logs for the run", async () => {
    const { box, fetchMock } = await createTestBox();
    const now = Math.floor(Date.now() / 1000);
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        logs: [
          { timestamp: now, level: "info", source: "agent", message: "started" },
          { timestamp: now + 10, level: "info", source: "agent", message: "done" },
        ],
      }),
    );

    const run = new Run(box, "agent", "run-1");
    const logs = await run.logs();
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0]!.message).toBe("started");
  });

  it("defaults to agent type", async () => {
    const { box } = await createTestBox();
    const run = new Run(box, "agent");
    expect(run.type).toBe("agent");
  });

  it("supports command type", async () => {
    const { box } = await createTestBox();
    const run = new Run(box, "command");
    expect(run.type).toBe("command");
  });

  it("supports code type", async () => {
    const { box } = await createTestBox();
    const run = new Run(box, "code");
    expect(run.type).toBe("code");
  });

  it("generates UUID when no id provided", async () => {
    const { box } = await createTestBox();
    const run = new Run(box, "agent");
    expect(run.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("Run does not have Symbol.asyncIterator", async () => {
    const { box } = await createTestBox();
    const run = new Run(box, "agent");
    expect(Symbol.asyncIterator in run).toBe(false);
  });
});

describe("StreamRun", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.restoreAllMocks());

  it("extends Run", async () => {
    const { box } = await createTestBox();
    const run = new StreamRun(box, "agent");
    expect(run).toBeInstanceOf(Run);
  });

  it("is async iterable", async () => {
    const { box } = await createTestBox();
    const run = new StreamRun<string, Chunk>(box, "agent");

    async function* gen(): AsyncGenerator<Chunk> {
      yield { type: "text-delta", text: "hello" };
    }
    StreamRun._setIterator(run, gen());

    const chunks: Chunk[] = [];
    for await (const chunk of run) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([{ type: "text-delta", text: "hello" }]);
  });

  it("has all Run properties", async () => {
    const { box } = await createTestBox();
    const run = new StreamRun(box, "agent", "sr-1");
    Run._update(run, { status: "completed", result: "done" });

    expect(run.id).toBe("sr-1");
    expect(run.status).toBe("completed");
    expect(run.result).toBe("done");
    expect(run.type).toBe("agent");
  });
});
