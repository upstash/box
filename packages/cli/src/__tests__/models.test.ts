import { describe, expect, it } from "vitest";
import {
  Agent,
  ClaudeCode,
  CursorModel,
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

  it("includes Cursor models", () => {
    const cursorModels = MODEL_OPTIONS_BY_AGENT[Agent.Cursor].flatMap((group) => group.options);

    expect(cursorModels).toContainEqual({
      value: CursorModel.Composer_2_5,
      label: "Composer 2.5",
    });
  });
});
