import { describe, expect, it } from "vitest";
import {
  Agent,
  ClaudeCode,
  CursorModel,
  OpenCodeModel,
  OpenRouterModel,
  VercelModel,
} from "@upstash/box";
import { MODEL_OPTIONS_BY_AGENT } from "../models.js";

describe("MODEL_OPTIONS_BY_AGENT", () => {
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

  it("includes Cursor models", () => {
    const cursorModels = MODEL_OPTIONS_BY_AGENT[Agent.Cursor].flatMap((group) => group.options);

    expect(cursorModels).toContainEqual({
      value: CursorModel.Composer_2_5,
      label: "Composer 2.5",
    });
  });
});
