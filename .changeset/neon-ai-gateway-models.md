---
"@upstash/box": patch
"@upstash/box-cli": patch
---

Add Neon AI Gateway models: `NeonModel` (`neon/<neon-short-id>`) for the Codex and
OpenCode harnesses. `inferDefaultProvider` routes `neon/gpt-*` to Codex, except
`neon/gpt-oss-*`, and every other Neon model to OpenCode (GPT OSS, Claude, Gemini,
Llama, Qwen, Kimi, GLM, Grok). Neon's Claude models run on OpenCode only, because Neon
serves them through chat completions and not the Responses API. Box does not run
Claude Code with Neon. The CLI model picker lists them for Codex and OpenCode.
Runs use the Neon credential (token and branch base URL) saved in the console.
