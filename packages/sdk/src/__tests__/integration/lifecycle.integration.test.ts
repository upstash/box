import { describe, it, expect, afterAll } from "vitest";
import { Box } from "../../index.js";
import { UPSTASH_BOX_API_KEY, withBox, cleanupSharedBox } from "./setup.js";

afterAll(() => cleanupSharedBox());

describe.skipIf(!UPSTASH_BOX_API_KEY)("lifecycle", () => {
  it.concurrent("getStatus: returns idle", () =>
    withBox(
      async (box) => {
        const { status } = await box.getStatus();
        expect(status).toBe("idle");
      },
      { shared: true },
    ),
  );

  // needs its own box — asserts on exact run history
  it.concurrent("listRuns: shows exec run", () =>
    withBox(async (box) => {
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
    }),
  );

  it.concurrent("run.logs: returns logs for a completed run", () =>
    withBox(
      async (box) => {
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
      },
      { shared: true },
    ),
  );

  it.concurrent(
    "run.cost: returns cost info for a completed agent run",
    () =>
      withBox(
        async (box) => {
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
        },
        { shared: true },
      ),
    120000,
  );

  it.concurrent(
    "run.cancel: cancels a running agent execution",
    () =>
      withBox(
        async (box) => {
          // Start streaming so the run is in-flight
          const stream = box.agent.stream({
            prompt:
              "Write a very long essay about the history of computing. Make it extremely detailed.",
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
        },
        { shared: true },
      ),
    120000,
  );

  it.concurrent("box.logs: returns structured logs", () =>
    withBox(
      async (box) => {
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
      },
      { shared: true },
    ),
  );

  // pause/resume needs its own box — pausing would affect other concurrent tests
  it.concurrent(
    "lifecycle: pause then resume with status checks",
    () =>
      withBox(async (box) => {
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
      }),
    60000,
  );

  // snapshot needs its own box — snapshot operations are box-specific
  it.concurrent(
    "snapshot: create, list, delete",
    () =>
      withBox(async (box) => {
        const snap = await box.snapshot({ name: "integration-test-snap" });
        expect(snap.id).toBeTruthy();
        expect(snap.status).toBe("ready");

        const snapshots = await box.listSnapshots();
        expect(snapshots.some((s) => s.id === snap.id)).toBe(true);

        await box.deleteSnapshot(snap.id);
      }),
    120000,
  );

  it.concurrent("Box.list: shows this box", () =>
    withBox(
      async (box) => {
        const boxes = await Box.list({ apiKey: UPSTASH_BOX_API_KEY! });
        expect(boxes.some((b) => b.id === box.id)).toBe(true);
      },
      { shared: true },
    ),
  );

  it.concurrent("Box.get: reconnects to this box", () =>
    withBox(
      async (box) => {
        const reconnected = await Box.get(box.id, { apiKey: UPSTASH_BOX_API_KEY! });
        expect(reconnected.id).toBe(box.id);
      },
      { shared: true },
    ),
  );
});
