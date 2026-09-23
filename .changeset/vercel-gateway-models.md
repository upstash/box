---
"@upstash/box": patch
"@upstash/box-cli": patch
---

Fix Vercel AI Gateway Grok model identifiers: the gateway moved xAI models from
the `xai/` to the `spacexai/` namespace, so `VercelModel.Grok_*` now resolve
again. Add `VercelModel.Grok_4_7`, `GPT_6_Sol`, `GPT_6_Luna`, and
`Gemini_3_8_Flash`, with matching CLI picker options.
