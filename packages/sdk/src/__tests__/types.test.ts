import { describe, expect, it } from "vitest";
import {
  ClaudeCode,
  CursorModel,
  OpenAICodex,
  OpenCodeModel,
  OpenRouterModel,
  VercelModel,
} from "../types.js";

describe("Claude Opus 5.5 model identifiers", () => {
  it.each([
    ["Claude Code", ClaudeCode.Opus_5_5, "anthropic/claude-opus-5-5"],
    ["OpenRouter", OpenRouterModel.Claude_Opus_5_5, "openrouter/anthropic/claude-opus-5.5"],
    ["Vercel", VercelModel.Claude_Opus_5_5, "vercel/anthropic/claude-opus-5.5"],
    ["OpenCode Anthropic", OpenCodeModel.Claude_Opus_5_5, "opencode/claude-opus-5-5"],
    ["OpenCode Zen", OpenCodeModel.Zen_Claude_Opus_5_5, "opencode/claude-opus-5-5"],
    ["Cursor", CursorModel.Claude_Opus_5_5, "cursor/claude-opus-5-5"],
  ])("exposes the %s model", (_provider, model, expected) => {
    expect(model).toBe(expected);
  });
});

describe("GPT-6 Sol and Luna model identifiers", () => {
  it.each([
    ["OpenAI Sol", OpenAICodex.GPT_6_Sol, "openai/gpt-6-sol"],
    ["OpenAI Luna", OpenAICodex.GPT_6_Luna, "openai/gpt-6-luna"],
    ["OpenRouter Sol", OpenRouterModel.GPT_6_Sol, "openrouter/openai/gpt-6-sol"],
    ["OpenRouter Luna", OpenRouterModel.GPT_6_Luna, "openrouter/openai/gpt-6-luna"],
    ["OpenCode Sol", OpenCodeModel.GPT_6_Sol, "opencode/gpt-6-sol"],
    ["OpenCode Luna", OpenCodeModel.GPT_6_Luna, "opencode/gpt-6-luna"],
  ])("exposes the %s model", (_provider, model, expected) => {
    expect(model).toBe(expected);
  });
});

describe("Vercel AI Gateway model identifiers", () => {
  it.each([
    ["Grok Build 0.1", VercelModel.Grok_Build_0_1, "vercel/spacexai/grok-build-0.1"],
    ["Grok 4.7", VercelModel.Grok_4_7, "vercel/spacexai/grok-4.7"],
    ["Grok 4.3", VercelModel.Grok_4_3, "vercel/spacexai/grok-4.3"],
    ["Grok 4.20 Reasoning", VercelModel.Grok_4_20_Reasoning, "vercel/spacexai/grok-4.20-reasoning"],
    ["GPT-6 Sol", VercelModel.GPT_6_Sol, "vercel/openai/gpt-6-sol"],
    ["GPT-6 Luna", VercelModel.GPT_6_Luna, "vercel/openai/gpt-6-luna"],
    ["Gemini 3.8 Flash", VercelModel.Gemini_3_8_Flash, "vercel/google/gemini-3.8-flash"],
  ])("exposes the %s model under the gateway's current namespace", (_name, model, expected) => {
    expect(model).toBe(expected);
  });

  it("does not use the retired xai/ namespace", () => {
    for (const value of Object.values(VercelModel)) {
      expect(value.startsWith("vercel/xai/")).toBe(false);
    }
  });
});

describe("Claude Opus 5 model identifiers", () => {
  it.each([
    ["Claude Code", ClaudeCode.Opus_5, "anthropic/claude-opus-5"],
    ["OpenRouter", OpenRouterModel.Claude_Opus_5, "openrouter/anthropic/claude-opus-5"],
    ["Vercel", VercelModel.Claude_Opus_5, "vercel/anthropic/claude-opus-5"],
    ["OpenCode Anthropic", OpenCodeModel.Claude_Opus_5, "opencode/claude-opus-5"],
    ["OpenCode Zen", OpenCodeModel.Zen_Claude_Opus_5, "opencode/claude-opus-5"],
    ["Cursor", CursorModel.Claude_Opus_5, "cursor/claude-opus-5"],
  ])("exposes the %s model", (_provider, model, expected) => {
    expect(model).toBe(expected);
  });
});
