---
"@upstash/box": patch
"@upstash/box-cli": patch
---

Add Claude Fable 5.1, and correct two model picker entries.

`Fable_5_1` is available on the Claude API, OpenRouter, Vercel AI Gateway and
OpenCode Zen. Note the spelling differs by provider: the Claude API and Zen use
`claude-fable-5-1`, while the OpenRouter and Vercel gateways list it as
`claude-fable-5.1`.

Removed `OpenAICodex.GPT_5_3_Codex_Spark` from the model picker. It is a ChatGPT
research preview rather than an API model. The enum member is still exported, so
this is not a breaking change; `OpenCodeModel.GPT_5_3_Codex_Spark` is unaffected
because Zen does sell it.

GPT-5 Nano moved from the free group to the paid group, since Zen now charges
$0.05 / $0.40 per MTok for it.
