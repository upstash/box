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

    expect(run.result).toBe("hello world");
  });

  it("returns empty string when result is null", async () => {
    const { box } = await createTestBox();
    const run = new Run<string>(box, "agent", "run-1");

    expect(run.result).toBe("");
  });

  it("returns local cost", async () => {
    const { box } = await createTestBox();

    const run = new Run(box, "agent", "run-1");
    run._inputTokens = 100;
    run._outputTokens = 50;
    run._computeMs = 5000;

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
