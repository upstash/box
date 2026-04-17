import { Agent, ClaudeCode, OpenAICodex, OpenCodeModel, OpenRouterModel } from "@upstash/box";

/** Model options grouped by agent */
export const MODEL_OPTIONS_BY_AGENT: Record<
  Agent,
  { label: string; options: { value: string; label: string }[] }[]
> = {
  [Agent.ClaudeCode]: [
    {
      label: "Anthropic",
      options: [
        { value: ClaudeCode.Opus_4_7, label: "Claude Opus 4.7" },
        { value: ClaudeCode.Opus_4_6, label: "Claude Opus 4.6" },
        { value: ClaudeCode.Opus_4_5, label: "Claude Opus 4.5" },
        { value: ClaudeCode.Sonnet_4_6, label: "Claude Sonnet 4.6" },
        { value: ClaudeCode.Sonnet_4_5, label: "Claude Sonnet 4.5" },
        { value: ClaudeCode.Sonnet_4, label: "Claude Sonnet 4" },
        { value: ClaudeCode.Haiku_4_5, label: "Claude Haiku 4.5" },
      ],
    },
    {
      label: "OpenRouter",
      options: [
        { value: OpenRouterModel.Claude_Opus_4_5, label: "Claude Opus 4.5 (OR)" },
        { value: OpenRouterModel.Claude_Sonnet_4, label: "Claude Sonnet 4 (OR)" },
        { value: OpenRouterModel.Claude_Haiku_4_5, label: "Claude Haiku 4.5 (OR)" },
        { value: OpenRouterModel.DeepSeek_R1, label: "DeepSeek R1 (OR)" },
        { value: OpenRouterModel.Gemini_2_5_Pro, label: "Gemini 2.5 Pro (OR)" },
        { value: OpenRouterModel.Gemini_2_5_Flash, label: "Gemini 2.5 Flash (OR)" },
        { value: OpenRouterModel.GPT_4_1, label: "GPT-4.1 (OR)" },
        { value: OpenRouterModel.O3, label: "o3 (OR)" },
        { value: OpenRouterModel.O4_Mini, label: "o4-mini (OR)" },
      ],
    },
  ],
  [Agent.Codex]: [
    {
      label: "OpenAI",
      options: [
        { value: OpenAICodex.GPT_5_3_Codex, label: "GPT-5.3 Codex" },
        { value: OpenAICodex.GPT_5_2_Codex, label: "GPT-5.2 Codex" },
        { value: OpenAICodex.GPT_5_1_Codex_Max, label: "GPT-5.1 Codex Max" },
        { value: OpenAICodex.GPT_5_1_Codex_Mini, label: "GPT-5.1 Codex Mini" },
      ],
    },
    {
      label: "OpenRouter",
      options: [
        { value: OpenRouterModel.Claude_Opus_4_5, label: "Claude Opus 4.5 (OR)" },
        { value: OpenRouterModel.Claude_Sonnet_4, label: "Claude Sonnet 4 (OR)" },
        { value: OpenRouterModel.Claude_Haiku_4_5, label: "Claude Haiku 4.5 (OR)" },
        { value: OpenRouterModel.DeepSeek_R1, label: "DeepSeek R1 (OR)" },
        { value: OpenRouterModel.Gemini_2_5_Pro, label: "Gemini 2.5 Pro (OR)" },
        { value: OpenRouterModel.Gemini_2_5_Flash, label: "Gemini 2.5 Flash (OR)" },
        { value: OpenRouterModel.GPT_4_1, label: "GPT-4.1 (OR)" },
        { value: OpenRouterModel.O3, label: "o3 (OR)" },
        { value: OpenRouterModel.O4_Mini, label: "o4-mini (OR)" },
      ],
    },
  ],
  [Agent.OpenCode]: [
    {
      label: "OpenCode — Free",
      options: [
        { value: OpenCodeModel.Zen_GPT_5_Nano, label: "GPT-5 Nano (Free)" },
        { value: OpenCodeModel.Zen_Big_Pickle, label: "Big Pickle (Free)" },
        { value: OpenCodeModel.Zen_MiniMax_M2_5_Free, label: "MiniMax M2.5 (Free)" },
      ],
    },
    {
      label: "OpenCode — Paid",
      options: [
        { value: OpenCodeModel.Zen_Claude_Sonnet_4_6, label: "Claude Sonnet 4.6" },
        { value: OpenCodeModel.Zen_Claude_Sonnet_4_5, label: "Claude Sonnet 4.5" },
        { value: OpenCodeModel.Zen_Claude_Sonnet_4, label: "Claude Sonnet 4" },
        { value: OpenCodeModel.Zen_Claude_Haiku_4_5, label: "Claude Haiku 4.5" },
        { value: OpenCodeModel.Zen_Claude_Opus_4_6, label: "Claude Opus 4.6" },
        { value: OpenCodeModel.Zen_Claude_Opus_4_5, label: "Claude Opus 4.5" },
        { value: OpenCodeModel.Zen_Claude_Opus_4_1, label: "Claude Opus 4.1" },
        { value: OpenCodeModel.Zen_Gemini_3_1_Pro, label: "Gemini 3.1 Pro" },
        { value: OpenCodeModel.Zen_Gemini_3_Pro, label: "Gemini 3 Pro" },
        { value: OpenCodeModel.Zen_Gemini_3_Flash, label: "Gemini 3 Flash" },
      ],
    },
    {
      label: "Anthropic",
      options: [
        { value: OpenCodeModel.Claude_Opus_4_6, label: "Claude Opus 4.6" },
        { value: OpenCodeModel.Claude_Opus_4_5, label: "Claude Opus 4.5" },
        { value: OpenCodeModel.Claude_Sonnet_4_6, label: "Claude Sonnet 4.6" },
        { value: OpenCodeModel.Claude_Sonnet_4_5, label: "Claude Sonnet 4.5" },
        { value: OpenCodeModel.Claude_Sonnet_4, label: "Claude Sonnet 4" },
        { value: OpenCodeModel.Claude_Haiku_4_5, label: "Claude Haiku 4.5" },
      ],
    },
    {
      label: "OpenAI",
      options: [
        { value: OpenCodeModel.GPT_5_3_Codex, label: "GPT-5.3 Codex" },
        { value: OpenCodeModel.GPT_5_2_Codex, label: "GPT-5.2 Codex" },
        { value: OpenCodeModel.GPT_5_1_Codex_Max, label: "GPT-5.1 Codex Max" },
        { value: OpenCodeModel.GPT_5_1_Codex_Mini, label: "GPT-5.1 Codex Mini" },
        { value: OpenCodeModel.GPT_4_1, label: "GPT-4.1" },
        { value: OpenCodeModel.O3, label: "o3" },
        { value: OpenCodeModel.O4_Mini, label: "o4-mini" },
      ],
    },
    {
      label: "OpenRouter",
      options: [
        { value: OpenRouterModel.Claude_Opus_4_5, label: "Claude Opus 4.5 (OR)" },
        { value: OpenRouterModel.Claude_Sonnet_4, label: "Claude Sonnet 4 (OR)" },
        { value: OpenRouterModel.Claude_Haiku_4_5, label: "Claude Haiku 4.5 (OR)" },
        { value: OpenRouterModel.DeepSeek_R1, label: "DeepSeek R1 (OR)" },
        { value: OpenRouterModel.Gemini_2_5_Pro, label: "Gemini 2.5 Pro (OR)" },
        { value: OpenRouterModel.Gemini_2_5_Flash, label: "Gemini 2.5 Flash (OR)" },
        { value: OpenRouterModel.GPT_4_1, label: "GPT-4.1 (OR)" },
        { value: OpenRouterModel.O3, label: "o3 (OR)" },
        { value: OpenRouterModel.O4_Mini, label: "o4-mini (OR)" },
      ],
    },
  ],
};
