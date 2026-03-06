import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod/v3";
import { Box, ClaudeCode } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";

const skillResultSchema = z.object({
  success: z.boolean(),
  content: z.string(),
});

describe.skipIf(!UPSTASH_BOX_API_KEY)("skills", () => {
  let box: Box;

  beforeAll(async () => {
    box = await Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: { model: ClaudeCode.Opus_4_6 },
      skills: ["upstash/qstash-js/qstash-js"],
    });
  }, 120000);

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it.skip("agent can use an installed skill", async () => {
    const run = await box.agent.run({
      prompt:
        "Using the qstash-js skill, explain how to publish a message with QStash. " +
        "If the skill is available and you can use it, return success: true and put a short summary in content. " +
        "If there is no skill available or it fails, return success: false and put the error reason in content.",
      responseSchema: skillResultSchema,
    });

    expect(run.result.success).toBe(true);
    expect(run.result.content).toBeTruthy();
  }, 180000);
});
