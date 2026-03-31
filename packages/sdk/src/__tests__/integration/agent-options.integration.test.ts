import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Agent, Box, ClaudeCode } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";

describe.skipIf(!UPSTASH_BOX_API_KEY)("options", () => {
  let box: Box<Agent.ClaudeCode>;

  beforeAll(async () => {
    box = await Box.create<Agent.ClaudeCode>({
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: { provider: Agent.ClaudeCode, model: ClaudeCode.Sonnet_4_6 },
    });
  }, 120000);

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("passes options to a run", async () => {
    const run = await box.agent.run({
      prompt: "Reply with exactly: AGENT_OPTIONS_TEST",
      options: {
        maxTurns: 2,
        effort: "low",
      },
    });

    expect(run.status).toBe("completed");
    expect(run.result).toContain("AGENT_OPTIONS_TEST");
  }, 120000);

  it("passes options to a stream", async () => {
    const run = await box.agent.stream({
      prompt: "Reply with exactly: STREAM_OPTIONS_TEST",
      options: {
        maxTurns: 2,
        effort: "low",
      },
    });

    let output = "";
    for await (const chunk of run) {
      if (chunk.type === "text-delta") output += chunk.text;
    }

    expect(run.status).toBe("completed");
    expect(output).toContain("STREAM_OPTIONS_TEST");
  }, 120000);
});
