import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod/v3";
import { Agent, Box, ClaudeCode, OpenAICodex } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";

describe.skipIf(!UPSTASH_BOX_API_KEY)("agent", () => {
  let box: Box;

  beforeAll(async () => {
    box = await Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: { provider: Agent.ClaudeCode, model: ClaudeCode.Sonnet_4_5 },
    });
  }, 120000);

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("agent.run: returns result", async () => {
    const run = await box.agent.run({
      prompt: "Reply with exactly: INTEGRATION_OK",
    });
    const result = run.result;
    expect(result).toBeTruthy();
  }, 120000);

  it("agent.stream: yields Chunk objects", async () => {
    let text = "";
    let chunkCount = 0;
    const run = await box.agent.stream({
      prompt: "Reply with exactly: STREAM_OK",
    });
    for await (const chunk of run) {
      chunkCount++;
      if (chunk.type === "text-delta") {
        text += chunk.text;
      }
    }
    expect(chunkCount).toBeGreaterThan(0);
    expect(text).toBeTruthy();
    expect(run.status).toBe("completed");
  }, 120000);

  it("agent.run: structured output with responseSchema", async () => {
    const schema = z.object({
      message: z.string(),
      messageSize: z.number(),
      secretCookie: z.string(),
    });

    const run = await box.agent.run({
      prompt: "say hi",
      responseSchema: schema,
    });

    const result = run.result;
    expect(result).toEqual({
      message: expect.any(String),
      messageSize: expect.any(Number),
      secretCookie: expect.any(String),
    });
  }, 120000);
});

describe.skipIf(!UPSTASH_BOX_API_KEY)("agent (OpenAI GPT-5.4)", () => {
  let box: Box<Agent.Codex>;

  beforeAll(async () => {
    box = await Box.create<Agent.Codex>({
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: { harness: Agent.Codex, model: OpenAICodex.GPT_5_4 },
    });
  }, 120000);

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("agent.run: returns non-empty result", async () => {
    const run = await box.agent.run({
      prompt: "Reply with exactly: OPENAI_OK",
    });
    expect(run.result).toBeTruthy();
    expect(run.result).toContain("OPENAI_OK");
    expect(run.status).toBe("completed");
  }, 120000);

  it("agent.stream: yields text-delta chunks", async () => {
    let text = "";
    let chunkCount = 0;
    const run = await box.agent.stream({
      prompt: "Reply with exactly: OPENAI_STREAM_OK",
    });
    for await (const chunk of run) {
      chunkCount++;
      if (chunk.type === "text-delta") {
        text += chunk.text;
      }
    }
    expect(chunkCount).toBeGreaterThan(0);
    expect(text).toBeTruthy();
    expect(run.status).toBe("completed");
  }, 120000);
});
