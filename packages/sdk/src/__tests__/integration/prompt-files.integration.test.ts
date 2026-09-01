import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Agent, Box, ClaudeCode } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE_CSV_PATH = resolve(__dirname, "fixtures/sample.csv");
const SAMPLE_TXT_PATH = resolve(__dirname, "fixtures/sample.txt");

/**
 * Each describe shares one box across its tests. A run that ends badly leaves
 * the box busy, and the next test then fails with 409 "Box cannot start a run
 * in its current state", which reports one failure as two and hides the cause.
 */
async function waitUntilIdle(box: Box<Agent.ClaudeCode>): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const { status } = await box.getStatus();
    if (status !== "running") return;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

describe.skipIf(!UPSTASH_BOX_API_KEY)("prompt files — base64 JSON", () => {
  let box: Box<Agent.ClaudeCode>;

  beforeAll(async () => {
    box = await Box.create<Agent.ClaudeCode>({
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: { provider: Agent.ClaudeCode, model: ClaudeCode.Haiku_4_5 },
    });
  }, 120000);

  beforeEach(async () => {
    await waitUntilIdle(box);
  }, 90000);

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("accepts a base64 image in a run", async () => {
    // 1x1 red PNG
    const tinyPng =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

    const run = await box.agent.run({
      prompt: "Describe this image in one word. Reply with ONLY that word.",
      files: [{ data: tinyPng, mediaType: "image/png", filename: "red.png" }],
      options: { maxTurns: 3 },
    });

    expect(run.status).toBe("completed");
    expect(run.result.length).toBeGreaterThan(0);
  }, 120000);

  it("accepts a base64 image in a stream", async () => {
    const tinyPng =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";

    const run = await box.agent.stream({
      prompt: "What color is this image? Reply with ONLY the color name.",
      files: [{ data: tinyPng, mediaType: "image/png" }],
      options: { maxTurns: 3 },
    });

    let output = "";
    for await (const chunk of run) {
      if (chunk.type === "text-delta") output += chunk.text;
    }

    expect(run.status).toBe("completed");
    expect(output.length).toBeGreaterThan(0);
  }, 120000);
});

describe.skipIf(!UPSTASH_BOX_API_KEY)("prompt files — file paths (multipart)", () => {
  let box: Box<Agent.ClaudeCode>;

  beforeAll(async () => {
    box = await Box.create<Agent.ClaudeCode>({
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: { provider: Agent.ClaudeCode, model: ClaudeCode.Haiku_4_5 },
    });
  }, 120000);

  beforeEach(async () => {
    await waitUntilIdle(box);
  }, 90000);

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("uploads a local CSV file in a run", async () => {
    const run = await box.agent.run({
      prompt:
        "How many rows of data are in this CSV (excluding the header)? Reply with ONLY the number.",
      files: [SAMPLE_CSV_PATH],
      options: { maxTurns: 3 },
    });

    expect(run.status).toBe("completed");
    expect(run.result).toContain("3");
  }, 120000);

  it("uploads a local CSV file in a stream", async () => {
    const run = await box.agent.stream({
      prompt: "What is the oldest person's name in this CSV? Reply with ONLY the name.",
      files: [SAMPLE_CSV_PATH],
      options: { maxTurns: 3 },
    });

    let output = "";
    for await (const chunk of run) {
      if (chunk.type === "text-delta") output += chunk.text;
    }

    expect(run.status).toBe("completed");
    expect(output.toLowerCase()).toContain("charlie");
  }, 120000);
});

describe.skipIf(!UPSTASH_BOX_API_KEY)("prompt files — file paths (txt)", () => {
  let box: Box<Agent.ClaudeCode>;

  beforeAll(async () => {
    box = await Box.create<Agent.ClaudeCode>({
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: { provider: Agent.ClaudeCode, model: ClaudeCode.Haiku_4_5 },
    });
  }, 120000);

  beforeEach(async () => {
    await waitUntilIdle(box);
  }, 90000);

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("uploads a local TXT file in a run", async () => {
    const run = await box.agent.run({
      prompt:
        "How many rows of data are in this file (excluding the header)? Reply with ONLY the number.",
      files: [SAMPLE_TXT_PATH],
      options: { maxTurns: 3 },
    });

    expect(run.status).toBe("completed");
    expect(run.result).toContain("3");
  }, 120000);

  it("uploads a local TXT file in a stream", async () => {
    const run = await box.agent.stream({
      prompt: "What is the oldest person's name in this file? Reply with ONLY the name.",
      files: [SAMPLE_TXT_PATH],
      options: { maxTurns: 3 },
    });

    let output = "";
    for await (const chunk of run) {
      if (chunk.type === "text-delta") output += chunk.text;
    }

    expect(run.status).toBe("completed");
    expect(output.toLowerCase()).toContain("charlie");
  }, 120000);
});
