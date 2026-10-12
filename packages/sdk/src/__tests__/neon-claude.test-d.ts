import { describe, expectTypeOf, it } from "vitest";
import { Agent, type AgentConfig, NeonModel, type NeonClaudeModel } from "../types.js";

// The model type of the Claude Code harness branch (the `harness` form and the
// deprecated `provider` form). AgentConfig also has a permissive string/string
// fallback for custom harnesses; Extract leaves it out because a plain string
// harness is not assignable to Agent.ClaudeCode.
type ClaudeHarnessModel = Extract<AgentConfig, { harness: Agent.ClaudeCode }>["model"];
type ClaudeProviderModel = Extract<AgentConfig, { provider: Agent.ClaudeCode }>["model"];

describe("Claude Code on Neon AI Gateway (type level)", () => {
  it("accepts the Neon Claude models on both Claude Code branches", () => {
    expectTypeOf<NeonModel.Claude_Opus_5_5>().toExtend<NeonClaudeModel>();
    expectTypeOf<NeonModel.Claude_Haiku_4_5>().toExtend<ClaudeHarnessModel>();
    expectTypeOf<NeonModel.Claude_Fable_5_1>().toExtend<ClaudeProviderModel>();
  });

  it("rejects non-Claude Neon models", () => {
    expectTypeOf<NeonModel.GPT_5_5>().not.toExtend<NeonClaudeModel>();
    expectTypeOf<NeonModel.GPT_5_5>().not.toExtend<ClaudeHarnessModel>();
    expectTypeOf<NeonModel.Gemini_3_6_Flash>().not.toExtend<ClaudeProviderModel>();
    // @ts-expect-error GPT is not served on Neon's Anthropic Messages API
    const gpt: NeonClaudeModel = NeonModel.GPT_5_5;
    void gpt;
  });
});
