import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod/v3";
import { Box, Agent, ClaudeCode } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE_CSV_PATH = resolve(__dirname, "fixtures/sample.csv");

const WEBHOOK_URL = "https://testing-ma-feat.requestcatcher.com";

/**
 * Polls box.listRuns() until a run with the given ID reaches a terminal status.
 */
async function waitForRun(
  box: Box,
  runId: string,
  timeoutMs = 20_000,
  intervalMs = 1_000,
): Promise<{ status: string; output?: string }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const runs = await box.listRuns();
    const run = runs.find((r) => r.id === runId || r.box_id === runId);
    if (run && (run.status === "completed" || run.status === "failed")) {
      return { status: run.status, output: run.output };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Run ${runId} did not complete within ${timeoutMs}ms`);
}

describe.skipIf(!UPSTASH_BOX_API_KEY)("agent.run with webhook", () => {
  let box: Box;

  beforeAll(async () => {
    box = await Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: { provider: Agent.ClaudeCode, model: ClaudeCode.Sonnet_4_5 },
    });
  }, 120_000);

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30_000);

  it("returns immediately with status running", async () => {
    const run = await box.agent.run({
      prompt: "Reply with exactly: WEBHOOK_OK",
      webhook: { url: WEBHOOK_URL },
    });

    expect(run.id).toBeTruthy();
    expect(run.status).toBe("running");
  }, 30_000);

  it("sends webhook with custom headers", async () => {
    const run = await box.agent.run({
      prompt: "Reply with exactly: WEBHOOK_HEADERS_OK",
      webhook: {
        url: WEBHOOK_URL,
        headers: { "X-Test-Header": "integration-test" },
      },
    });

    expect(run.id).toBeTruthy();
    expect(run.status).toBe("running");
  }, 30_000);

  it("sends webhook with responseSchema (json_schema)", async () => {
    const schema = z.object({
      message: z.string(),
      count: z.number(),
    });

    const run = await box.agent.run({
      prompt: "say hi",
      responseSchema: schema,
      webhook: { url: WEBHOOK_URL },
    });

    expect(run.id).toBeTruthy();
    expect(run.status).toBe("running");
  }, 30_000);

  it("sends multipart file paths with webhook", async () => {
    const run = await box.agent.run({
      prompt:
        "How many rows of data are in this CSV (excluding the header)? Reply with ONLY the number.",
      files: [SAMPLE_CSV_PATH],
      webhook: { url: WEBHOOK_URL, headers: { "X-Test-Header": "file-upload" } },
    });

    expect(run.id).toBeTruthy();
    expect(run.status).toBe("running");

    const completed = await waitForRun(box, run.id);
    expect(completed.status).toBe("completed");
    expect(completed.output).toContain("3");
  }, 30_000);

  it("webhook run eventually completes and appears in listRuns", async () => {
    const run = await box.agent.run({
      prompt: "Reply with exactly: POLL_CHECK",
      webhook: { url: WEBHOOK_URL },
    });

    expect(run.status).toBe("running");

    const completed = await waitForRun(box, run.id);
    expect(completed.status).toBe("completed");
    expect(completed.output).toBeTruthy();
  }, 180_000);
});
