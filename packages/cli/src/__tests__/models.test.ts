import { describe, expect, it } from "vitest";
import {
  Agent,
  ClaudeCode,
  CursorModel,
  NeonModel,
  OpenAICodex,
  OpenCodeModel,
  OpenRouterModel,
  VercelModel,
} from "@upstash/box";
import { MODEL_OPTIONS_BY_AGENT } from "../models.js";

describe("MODEL_OPTIONS_BY_AGENT", () => {
  it.each([
    [Agent.ClaudeCode, "Anthropic", ClaudeCode.Opus_5_5, "Claude Opus 5.5"],
    [Agent.ClaudeCode, "OpenRouter", OpenRouterModel.Claude_Opus_5_5, "Claude Opus 5.5 (OR)"],
    [
      Agent.ClaudeCode,
      "Vercel AI Gateway",
      VercelModel.Claude_Opus_5_5,
      "Claude Opus 5.5 (Vercel)",
    ],
    [Agent.Codex, "OpenRouter", OpenRouterModel.Claude_Opus_5_5, "Claude Opus 5.5 (OR)"],
    [Agent.Codex, "Vercel AI Gateway", VercelModel.Claude_Opus_5_5, "Claude Opus 5.5 (Vercel)"],
    [Agent.OpenCode, "OpenCode — Paid", OpenCodeModel.Zen_Claude_Opus_5_5, "Claude Opus 5.5"],
    [Agent.OpenCode, "Anthropic", OpenCodeModel.Claude_Opus_5_5, "Claude Opus 5.5"],
    [Agent.OpenCode, "OpenRouter", OpenRouterModel.Claude_Opus_5_5, "Claude Opus 5.5 (OR)"],
    [Agent.OpenCode, "Vercel AI Gateway", VercelModel.Claude_Opus_5_5, "Claude Opus 5.5 (Vercel)"],
    [Agent.Cursor, "Cursor", CursorModel.Claude_Opus_5_5, "Claude Opus 5.5"],
  ])("includes Claude Opus 5.5 for %s via %s", (agent, groupLabel, value, label) => {
    const group = MODEL_OPTIONS_BY_AGENT[agent].find(({ label }) => label === groupLabel);

    expect(group?.options).toContainEqual({ value, label });
  });

  it.each([
    [Agent.ClaudeCode, "Anthropic", ClaudeCode.Opus_5, "Claude Opus 5"],
    [Agent.ClaudeCode, "OpenRouter", OpenRouterModel.Claude_Opus_5, "Claude Opus 5 (OR)"],
    [Agent.ClaudeCode, "Vercel AI Gateway", VercelModel.Claude_Opus_5, "Claude Opus 5 (Vercel)"],
    [Agent.Codex, "OpenRouter", OpenRouterModel.Claude_Opus_5, "Claude Opus 5 (OR)"],
    [Agent.Codex, "Vercel AI Gateway", VercelModel.Claude_Opus_5, "Claude Opus 5 (Vercel)"],
    [Agent.OpenCode, "OpenCode — Paid", OpenCodeModel.Zen_Claude_Opus_5, "Claude Opus 5"],
    [Agent.OpenCode, "Anthropic", OpenCodeModel.Claude_Opus_5, "Claude Opus 5"],
    [Agent.OpenCode, "OpenRouter", OpenRouterModel.Claude_Opus_5, "Claude Opus 5 (OR)"],
    [Agent.OpenCode, "Vercel AI Gateway", VercelModel.Claude_Opus_5, "Claude Opus 5 (Vercel)"],
    [Agent.Cursor, "Cursor", CursorModel.Claude_Opus_5, "Claude Opus 5"],
  ])("includes Claude Opus 5 for %s via %s", (agent, groupLabel, value, label) => {
    const group = MODEL_OPTIONS_BY_AGENT[agent].find(({ label }) => label === groupLabel);

    expect(group?.options).toContainEqual({ value, label });
  });

  it.each([
    [Agent.ClaudeCode, VercelModel.Grok_4_7, "Grok 4.7 (Vercel)"],
    [Agent.ClaudeCode, VercelModel.Gemini_3_8_Flash, "Gemini 3.8 Flash (Vercel)"],
    [Agent.Codex, VercelModel.GPT_6_Sol, "GPT-6 Sol (Vercel)"],
    [Agent.Codex, VercelModel.GPT_6_Luna, "GPT-6 Luna (Vercel)"],
    [Agent.OpenCode, VercelModel.GPT_6_Sol, "GPT-6 Sol (Vercel)"],
    [Agent.OpenCode, VercelModel.Grok_4_7, "Grok 4.7 (Vercel)"],
  ])("includes current Vercel AI Gateway models for %s", (agent, value, label) => {
    const group = MODEL_OPTIONS_BY_AGENT[agent].find(({ label }) => label === "Vercel AI Gateway");

    expect(group?.options).toContainEqual({ value, label });
  });

  it.each([
    [Agent.Codex, "OpenAI", OpenAICodex.GPT_6_Sol, "GPT-6 Sol"],
    [Agent.Codex, "OpenAI", OpenAICodex.GPT_6_Luna, "GPT-6 Luna"],
    [Agent.Codex, "OpenRouter", OpenRouterModel.GPT_6_Sol, "GPT-6 Sol (OR)"],
    [Agent.OpenCode, "OpenAI", OpenCodeModel.GPT_6_Sol, "GPT-6 Sol"],
    [Agent.OpenCode, "OpenAI", OpenCodeModel.GPT_6_Luna, "GPT-6 Luna"],
  ])("includes GPT-6 Sol and Luna for %s via %s", (agent, groupLabel, value, label) => {
    const group = MODEL_OPTIONS_BY_AGENT[agent].find(({ label }) => label === groupLabel);

    expect(group?.options).toContainEqual({ value, label });
  });

  it.each([
    [Agent.Codex, "OpenAI", OpenAICodex.GPT_6_1_Sol, "GPT-6.1 Sol"],
    [Agent.Codex, "OpenRouter", OpenRouterModel.GPT_6_1_Sol, "GPT-6.1 Sol (OR)"],
    [Agent.Codex, "Vercel AI Gateway", VercelModel.GPT_6_1_Sol, "GPT-6.1 Sol (Vercel)"],
    [Agent.OpenCode, "OpenAI", OpenCodeModel.GPT_6_1_Sol, "GPT-6.1 Sol"],
    [Agent.OpenCode, "OpenRouter", OpenRouterModel.GPT_6_1_Sol, "GPT-6.1 Sol (OR)"],
    [Agent.OpenCode, "Vercel AI Gateway", VercelModel.GPT_6_1_Sol, "GPT-6.1 Sol (Vercel)"],
  ])("includes GPT-6.1 Sol for %s via %s", (agent, groupLabel, value, label) => {
    const group = MODEL_OPTIONS_BY_AGENT[agent].find(({ label }) => label === groupLabel);

    expect(group?.options).toContainEqual({ value, label });
  });

  it("offers Neon AI Gateway models only to Codex and OpenCode", () => {
    const groupFor = (agent: Agent) =>
      MODEL_OPTIONS_BY_AGENT[agent].find(({ label }) => label === "Neon AI Gateway");

    expect(groupFor(Agent.ClaudeCode)).toBeUndefined();
    expect(groupFor(Agent.Cursor)).toBeUndefined();
    expect(groupFor(Agent.Codex)?.options).toContainEqual({
      value: NeonModel.GPT_5_5,
      label: "GPT-5.5 (Neon)",
    });
    expect(groupFor(Agent.OpenCode)?.options).toContainEqual({
      value: NeonModel.Gemini_3_6_Flash,
      label: "Gemini 3.6 Flash (Neon)",
    });
  });

  it("splits Neon models by endpoint support", () => {
    const values = (agent: Agent) =>
      MODEL_OPTIONS_BY_AGENT[agent]
        .find(({ label }) => label === "Neon AI Gateway")
        ?.options.map((o) => o.value) ?? [];

    // Responses-only on Neon: Codex yes, OpenCode no.
    expect(values(Agent.Codex)).toContain(NeonModel.GPT_5_5_Pro);
    expect(values(Agent.Codex)).toContain(NeonModel.GPT_5_3_Codex);
    expect(values(Agent.OpenCode)).not.toContain(NeonModel.GPT_5_5_Pro);
    expect(values(Agent.OpenCode)).not.toContain(NeonModel.GPT_5_3_Codex);
    // Chat-only on Neon: OpenCode yes, Codex no.
    expect(values(Agent.OpenCode)).toContain(NeonModel.GPT_OSS_120B);
    expect(values(Agent.OpenCode)).toContain(NeonModel.Kimi_K3);
    expect(values(Agent.Codex)).not.toContain(NeonModel.GPT_OSS_120B);
    expect(values(Agent.Codex)).not.toContain(NeonModel.Kimi_K3);
    // Claude on Neon: chat completions only, so OpenCode yes, Codex no.
    expect(values(Agent.OpenCode)).toContain(NeonModel.Claude_Haiku_4_5);
    expect(values(Agent.OpenCode)).toContain(NeonModel.Claude_Opus_5_5);
    expect(values(Agent.Codex).some((v) => v.startsWith("neon/claude-"))).toBe(false);
    // GPT-5.4 and newer refuse tools with reasoning on Neon chat completions: Codex only.
    for (const model of [
      NeonModel.GPT_6_Astra,
      NeonModel.GPT_5_6_Sol,
      NeonModel.GPT_5_6_Terra,
      NeonModel.GPT_5_6_Luna,
      NeonModel.GPT_5_5,
      NeonModel.GPT_5_4,
      NeonModel.GPT_5_4_Mini,
      NeonModel.GPT_5_4_Nano,
    ]) {
      expect(values(Agent.Codex)).toContain(model);
      expect(values(Agent.OpenCode)).not.toContain(model);
    }
    expect(values(Agent.OpenCode)).toContain(NeonModel.GPT_5_Nano);
  });

  it("includes Cursor models", () => {
    const cursorModels = MODEL_OPTIONS_BY_AGENT[Agent.Cursor].flatMap((group) => group.options);

    expect(cursorModels).toContainEqual({
      value: CursorModel.Composer_2_5,
      label: "Composer 2.5",
    });
  });
});
