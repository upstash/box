import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Box, ClaudeCode } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";

describe.skipIf(!UPSTASH_BOX_API_KEY)("configureModel", () => {
  let box: Box;

  beforeAll(async () => {
    box = await Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: { model: ClaudeCode.Sonnet_4_5 },
    });
  }, 120000);

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("changes the model without error", async () => {
    await expect(box.configureModel(ClaudeCode.Haiku_4_5)).resolves.toBeUndefined();
  });

  it("box is still accessible after model change", async () => {
    const reconnected = await Box.get(box.id, { apiKey: UPSTASH_BOX_API_KEY! });
    expect(reconnected.id).toBe(box.id);
  });

  it("can run agent after model change", async () => {
    const run = await box.agent.run({ prompt: "Reply with exactly: MODEL_TEST" });
    expect(run.status).toBe("completed");
    expect(run.result).toContain("MODEL_TEST");
  }, 120000);
});
