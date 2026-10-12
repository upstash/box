---
"@upstash/box": patch
"@upstash/box-cli": patch
---

Claude Code on Neon AI Gateway: the Claude Code harness accepts the Neon Claude
models (`NeonClaudeModel`, e.g. `NeonModel.Claude_Opus_5_5`), which Neon serves on
its Anthropic Messages API, and the CLI picker lists them under Claude Code. The
default harness inferred for `neon/claude-*` stays OpenCode.
