import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Box, ClaudeCode } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";

describe.skipIf(!UPSTASH_BOX_API_KEY)("lifecycle", () => {
  let box: Box;
  let snapshotId: string;

  beforeAll(async () => {
    box = await Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: { model: ClaudeCode.Opus_4_6 },
    });
  }, 120000);

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("getStatus: returns idle", async () => {
    const { status } = await box.getStatus();
    expect(status).toBe("idle");
  });

  it("listRuns: shows exec run", async () => {
    // Run a command first so there's at least one run
    await box.exec.command("echo warmup");
    const runs = await box.listRuns();
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs[0]).toEqual({
      id: expect.any(String),
      box_id: box.id,
      type: "shell",
      status: "completed",
      prompt: "sh -c echo warmup",
      input_tokens: 0,
      output_tokens: 0,
      cpu_ns: expect.any(Number),
      cost_usd: expect.any(Number),
      compute_cost_usd: expect.any(Number),
      duration_ms: expect.any(Number),
      created_at: expect.any(Number),
      customer_id: expect.any(String),
      completed_at: expect.any(Number),
    });
  });

  it("run.logs: returns logs for a completed run", async () => {
    const run = await box.exec.command("echo log-test");
    expect(run._status).toBe("completed");

    const logs = await run.logs();
    expect(Array.isArray(logs)).toBe(true);
    for (const log of logs) {
      expect(log).toEqual({
        timestamp: expect.any(String),
        level: expect.stringMatching(/^(info|warn|error)$/),
        message: expect.any(String),
      });
    }
  });

  it("run.cost: returns cost info for a completed agent run", async () => {
    const run = await box.agent.run({
      prompt: "Reply with exactly: COST_TEST",
    });

    const cost = run.cost;
    expect(cost).toEqual({
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
      computeMs: expect.any(Number),
      totalUsd: expect.any(Number),
    });
    expect(cost.computeMs).toBeGreaterThan(0);
  }, 120000);

  it("run.cancel: cancels a running agent execution", async () => {
    // Start streaming so the run is in-flight
    const stream = box.agent.stream({
      prompt: "Write a very long essay about the history of computing. Make it extremely detailed.",
    });

    // Read a few chunks then cancel
    const iterator = stream[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.done).not.toBe(true);

    // Get the run from listRuns while it's active, then cancel via the stream return
    await iterator.return!(undefined);

    // Verify the run shows up in listRuns
    const runs = await box.listRuns();
    expect(runs.length).toBeGreaterThanOrEqual(1);
  }, 120000);

  it("box.logs: returns structured logs", async () => {
    // Ensure there's activity to log
    await box.exec.command("echo logs-check");

    const logs = await box.logs();
    expect(Array.isArray(logs)).toBe(true);
    for (const log of logs) {
      expect(log).toEqual({
        timestamp: expect.any(Number),
        level: expect.stringMatching(/^(info|warn|error)$/),
        source: expect.stringMatching(/^(system|agent|user)$/),
        message: expect.any(String),
      });
    }
  });

  it("lifecycle: pause then resume with status checks", async () => {
    const before = await box.getStatus();
    expect(before.status).toBe("idle");

    await box.pause();
    await new Promise((r) => setTimeout(r, 3000));
    const afterPause = await box.getStatus();
    expect(afterPause.status).toBe("paused");

    await box.resume();
    await new Promise((r) => setTimeout(r, 5000));
    const afterResume = await box.getStatus();
    expect(afterResume.status).toBe("idle");
  }, 60000);

  it("snapshot: create, list, delete", async () => {
    const snap = await box.snapshot({ name: "integration-test-snap" });
    expect(snap.id).toBeTruthy();
    expect(snap.status).toBe("ready");
    snapshotId = snap.id;

    const snapshots = await box.listSnapshots();
    expect(snapshots.some((s) => s.id === snapshotId)).toBe(true);

    await box.deleteSnapshot(snapshotId);
  }, 120000);

  it("Box.list: shows this box", async () => {
    const boxes = await Box.list({ apiKey: UPSTASH_BOX_API_KEY! });
    expect(boxes.some((b) => b.id === box.id)).toBe(true);
  });

  it("Box.get: reconnects to this box", async () => {
    const reconnected = await Box.get(box.id, { apiKey: UPSTASH_BOX_API_KEY! });
    expect(reconnected.id).toBe(box.id);
  });
});
