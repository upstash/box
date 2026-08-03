import { describe, expect, it } from "vitest";
import { ClaudeCode, CursorModel, OpenCodeModel, OpenRouterModel, VercelModel } from "../types.js";

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
