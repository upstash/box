---
"@upstash/box": patch
"@upstash/box-cli": patch
---

Neon AI Gateway: GPT-5.4 and newer (GPT-6 Astra, GPT-5.6 Sol/Terra/Luna, GPT-5.5,
GPT-5.4/Mini/Nano) are offered for Codex only. Neon refuses tool calls with reasoning
for these models on chat completions, which OpenCode needs; Codex uses the Responses
API. The CLI picker no longer lists them under OpenCode.
