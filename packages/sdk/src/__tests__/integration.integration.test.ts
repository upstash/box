import { describe, it, expect, beforeAll, afterAll } from "vitest";
import dotenv from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Box, OpenAICodex } from "../index.js";

// Load .env from monorepo root before evaluating skip condition
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../../.env") });

const UPSTASH_BOX_API_KEY = process.env.UPSTASH_BOX_API_KEY;
const AGENT_API_KEY = process.env.AGENT_API_KEY;

describe.skipIf(!UPSTASH_BOX_API_KEY || !AGENT_API_KEY)("Integration tests", () => {
  let box: Box;
  let snapshotId: string;

  beforeAll(async () => {
    box = await Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: { model: OpenAICodex.GPT_5_1_Codex_Max, apiKey: AGENT_API_KEY! },
    });
  }, 120000);

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("exec: runs a shell command", async () => {
    const run = await box.exec("echo hello");
    expect(await run.result()).toContain("hello");
    expect(run._status).toBe("completed");
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

  it("lifecycle: stop then start", async () => {
    await box.stop();
    // Give it a moment to stop
    await new Promise((r) => setTimeout(r, 3000));
    await box.start();
    // Give it a moment to start
    await new Promise((r) => setTimeout(r, 5000));
    const { status } = await box.getStatus();
    expect(["idle"]).toContain(status);
  }, 60000);

  it("agent.run: returns result", async () => {
    const run = await box.agent.run({
      prompt: "Reply with exactly: INTEGRATION_OK",
    });
    const result = await run.result();
    expect(result).toBeTruthy();
  }, 120000);

  it("agent.stream: yields text chunks", async () => {
    const chunks: string[] = [];
    for await (const chunk of box.agent.stream({
      prompt: "Reply with exactly: STREAM_OK",
    })) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join("")).toBeTruthy();
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
