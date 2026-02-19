import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Run, Box } from "../client.js";
import { mockResponse, createTestBox } from "./helpers.js";

describe("Run", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.restoreAllMocks());

  it("returns cached terminal status without polling", async () => {
    const { box, fetchMock } = await createTestBox();
    const run = new Run(box, "agent", "run-1");
    run._status = "completed";

    const status = await run.status();
    expect(status).toBe("completed");
    // No additional fetch calls beyond the Box.get one
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("polls for status when still running", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(mockResponse({ status: "completed" }));

    const run = new Run(box, "agent", "run-1");
    run._status = "running";

    const status = await run.status();
    expect(status).toBe("completed");
  });

  it("returns result when set", async () => {
    const { box } = await createTestBox();
    const run = new Run<string>(box, "agent", "run-1");
    run._result = "hello world";

    const result = await run.result();
    expect(result).toBe("hello world");
  });

  it("returns empty string when result is null", async () => {
    const { box } = await createTestBox();
    const run = new Run<string>(box, "agent", "run-1");

    const result = await run.result();
    expect(result).toBe("");
  });

  it("yields stream chunks", async () => {
    const { box } = await createTestBox();
    const run = new Run(box, "agent", "run-1");
    run._streamChunks = ["hello", " ", "world"];

    const chunks: string[] = [];
    for await (const chunk of run.stream()) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual(["hello", " ", "world"]);
  });

  it("fetches cost from backend", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        input_tokens: 100,
        output_tokens: 50,
        duration_ms: 5000,
        cost_usd: 0.01,
      }),
    );

    const run = new Run(box, "agent", "run-1");
    const cost = await run.cost();
    expect(cost.tokens).toBe(150);
    expect(cost.computeMs).toBe(5000);
    expect(cost.totalUsd).toBe(0.01);
  });

  it("falls back to local cost on fetch failure", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockRejectedValueOnce(new Error("network"));

    const run = new Run(box, "agent", "run-1");
    run._inputTokens = 80;
    run._outputTokens = 40;
    run._computeMs = 3000;

    const cost = await run.cost();
    expect(cost.tokens).toBe(120);
    expect(cost.computeMs).toBe(3000);
    expect(cost.totalUsd).toBe(0);
  });

  it("cancels a run", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(mockResponse({}));

    const run = new Run(box, "agent", "run-1");
    run._abortController = new AbortController();

    await run.cancel();
    expect(run._status).toBe("cancelled");
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

  it("supports shell type", async () => {
    const { box } = await createTestBox();
    const run = new Run(box, "shell");
    expect(run.type).toBe("shell");
  });

  it("generates UUID when no id provided", async () => {
    const { box } = await createTestBox();
    const run = new Run(box, "agent");
    expect(run.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
