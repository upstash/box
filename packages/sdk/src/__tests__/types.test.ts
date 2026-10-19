import { describe, expect, it } from "vitest";
import {
  ClaudeCode,
  CursorModel,
  NeonModel,
  OpenAICodex,
  OpenCodeModel,
  OpenRouterModel,
  VercelModel,
} from "../types.js";

describe("Claude Sonnet 5.5 and Haiku 5.5 model identifiers", () => {
  it.each([
    ["Claude Code Sonnet", ClaudeCode.Sonnet_5_5, "anthropic/claude-sonnet-5-5"],
    ["Claude Code Haiku", ClaudeCode.Haiku_5_5, "anthropic/claude-haiku-5-5"],
    [
      "OpenRouter Sonnet",
      OpenRouterModel.Claude_Sonnet_5_5,
      "openrouter/anthropic/claude-sonnet-5.5",
    ],
    ["OpenRouter Haiku", OpenRouterModel.Claude_Haiku_5_5, "openrouter/anthropic/claude-haiku-5.5"],
    ["Vercel Sonnet", VercelModel.Claude_Sonnet_5_5, "vercel/anthropic/claude-sonnet-5.5"],
    ["Vercel Haiku", VercelModel.Claude_Haiku_5_5, "vercel/anthropic/claude-haiku-5.5"],
    ["OpenCode Anthropic Sonnet", OpenCodeModel.Claude_Sonnet_5_5, "opencode/claude-sonnet-5-5"],
    ["OpenCode Anthropic Haiku", OpenCodeModel.Claude_Haiku_5_5, "opencode/claude-haiku-5-5"],
    ["OpenCode Zen Sonnet", OpenCodeModel.Zen_Claude_Sonnet_5_5, "opencode/claude-sonnet-5-5"],
    ["OpenCode Zen Haiku", OpenCodeModel.Zen_Claude_Haiku_5_5, "opencode/claude-haiku-5-5"],
    ["Cursor Sonnet", CursorModel.Claude_Sonnet_5_5, "cursor/claude-sonnet-5-5"],
    ["Cursor Haiku", CursorModel.Claude_Haiku_5_5, "cursor/claude-haiku-5-5"],
  ])("exposes the %s model", (_provider, model, expected) => {
    expect(model).toBe(expected);
  });
});

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

describe("GPT-6.1 Sol model identifiers", () => {
  it.each([
    ["OpenAI", OpenAICodex.GPT_6_1_Sol, "openai/gpt-6.1-sol"],
    ["OpenRouter", OpenRouterModel.GPT_6_1_Sol, "openrouter/openai/gpt-6.1-sol"],
    ["Vercel", VercelModel.GPT_6_1_Sol, "vercel/openai/gpt-6.1-sol"],
    ["OpenCode", OpenCodeModel.GPT_6_1_Sol, "opencode/gpt-6.1-sol"],
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

describe("Neon AI Gateway model identifiers", () => {
  it.each([
    [NeonModel.GPT_5_5, "neon/gpt-5-5"],
    [NeonModel.GPT_5_3_Codex, "neon/gpt-5-3-codex"],
    [NeonModel.GPT_OSS_120B, "neon/gpt-oss-120b"],
    [NeonModel.Gemini_3_6_Flash, "neon/gemini-3-6-flash"],
    [NeonModel.Kimi_K3, "neon/kimi-k3"],
    [NeonModel.Claude_Opus_5_5, "neon/claude-opus-5-5"],
    [NeonModel.Claude_Haiku_4_5, "neon/claude-haiku-4-5"],
  ])("uses Neon's short id under the neon/ namespace: %s", (model, expected) => {
    expect(model).toBe(expected);
  });

  it("never carries a provider segment", () => {
    for (const value of Object.values(NeonModel)) {
      expect(value.startsWith("neon/")).toBe(true);
      expect(value.slice("neon/".length)).not.toContain("/");
    }
  });
});
