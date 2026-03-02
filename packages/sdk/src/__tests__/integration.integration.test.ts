import { describe, it, expect, beforeAll, afterAll } from "vitest";
import dotenv from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod/v3";
import { Box, ClaudeCode } from "../index.js";

// Load .env from monorepo root before evaluating skip condition
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../../.env") });

const UPSTASH_BOX_API_KEY = process.env.UPSTASH_BOX_API_KEY;

describe.skipIf(!UPSTASH_BOX_API_KEY)("Integration tests", () => {
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

  it("exec.command: runs a shell command", async () => {
    const run = await box.exec.command("echo hello");
    expect(run.result).toContain("hello");
    expect(run._status).toBe("completed");
  });

  it("exec.code: runs inline JavaScript", async () => {
    const result = await box.exec.code({
      code: "console.log(JSON.stringify({ sum: 1 + 2 }))",
      lang: "js",
    });
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain('"sum":3');
  });

  it("files: write then read roundtrip", async () => {
    await box.files.write({ path: "test-file.txt", content: "integration test content" });
    const content = await box.files.read("test-file.txt");
    expect(content).toBe("integration test content");
  });

  it("files: list shows written file", async () => {
    const files = await box.files.list();
    const found = files.some((f) => f.name === "test-file.txt");
    expect(found).toBe(true);
  });

  it("getStatus: returns running", async () => {
    const { status } = await box.getStatus();
    expect(status).toBe("idle");
  });

  it("listRuns: shows exec run", async () => {
    const runs = await box.listRuns();
    expect(runs.length).toBeGreaterThanOrEqual(1);
  });

  it("lifecycle: pause then resume with status checks", async () => {
    // Verify box is idle/running before pausing
    const before = await box.getStatus();
    expect(before.status).toBe("idle");

    // Pause and verify status transitions to paused
    await box.pause();
    await new Promise((r) => setTimeout(r, 3000));
    const afterPause = await box.getStatus();
    expect(afterPause.status).toBe("paused");

    // Resume and verify status transitions back
    await box.resume();
    await new Promise((r) => setTimeout(r, 5000));
    const afterResume = await box.getStatus();
    expect(afterResume.status).toBe("idle");
  }, 60000);

  it("agent.run: returns result", async () => {
    const run = await box.agent.run({
      prompt: "Reply with exactly: INTEGRATION_OK",
    });
    const result = run.result;
    expect(result).toBeTruthy();
  }, 120000);

  it("agent.stream: yields stream parts", async () => {
    let text = "";
    let partCount = 0;
    for await (const part of box.agent.stream({
      prompt: "Reply with exactly: STREAM_OK",
    })) {
      partCount++;
      if (part.type === "text-delta") {
        text += part.text;
      }
    }
    expect(partCount).toBeGreaterThan(0);
    expect(text).toBeTruthy();
  }, 120000);

  it("agent.run: structured output with responseSchema", async () => {
    const schema = z.object({
      city: z.string(),
      country: z.string(),
      population: z.number(),
    });

    const run = await box.agent.run({
      prompt:
        'Return a JSON object with city "Tokyo", country "Japan", and population 14000000. Nothing else.',
      responseSchema: schema,
    });

    const result = run.result;
    expect(result.city).toBe("Tokyo");
    expect(result.country).toBe("Japan");
    expect(typeof result.population).toBe("number");
  }, 120000);

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

describe.skipIf(!UPSTASH_BOX_API_KEY)("Integration tests (OpenAI)", () => {
  let box: Box;

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

  it("agent.run: returns result with OpenAI model", async () => {
    const run = await box.agent.run({
      prompt: "Reply with exactly: OPENAI_OK",
    });
    expect(run.result).toBeTruthy();
  }, 120000);

  it("agent.stream: yields stream parts with OpenAI model", async () => {
    let text = "";
    let partCount = 0;
    for await (const part of box.agent.stream({
      prompt: "Reply with exactly: OPENAI_STREAM_OK",
    })) {
      partCount++;
      if (part.type === "text-delta") {
        text += part.text;
      }
    }
    expect(partCount).toBeGreaterThan(0);
    expect(text).toBeTruthy();
  }, 120000);
});
