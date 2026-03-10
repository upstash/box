import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Box, ClaudeCode, Agent } from "../../index.js";
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

  it("starts with the initial model config", () => {
    const config = box.modelConfig;
    expect(config.model).toBe(ClaudeCode.Sonnet_4_5);
    expect(config.runner).toBe(Agent.ClaudeCode);
  });

  it("changes to Haiku and reflects in modelConfig", async () => {
    await box.configureModel(ClaudeCode.Haiku_4_5);

    const config = box.modelConfig;
    expect(config.model).toBe(ClaudeCode.Haiku_4_5);
  });

  it("changes to Opus and reflects in modelConfig", async () => {
    await box.configureModel(ClaudeCode.Opus_4_5);

    const config = box.modelConfig;
    expect(config.model).toBe(ClaudeCode.Opus_4_5);
  });

  it("changes back to Sonnet", async () => {
    await box.configureModel(ClaudeCode.Sonnet_4_5);

    const config = box.modelConfig;
    expect(config.model).toBe(ClaudeCode.Sonnet_4_5);
  });

  it("reconnected box reflects server model", async () => {
    await box.configureModel(ClaudeCode.Haiku_4_5);

    const reconnected = await Box.get(box.id, { apiKey: UPSTASH_BOX_API_KEY! });
    expect(reconnected.modelConfig.model).toBe(ClaudeCode.Haiku_4_5);
    expect(reconnected.modelConfig.runner).toBe(Agent.ClaudeCode);
  });
});
