---
"@upstash/box-cli": patch
---

Add `--effort <level>` to `box run`, `box schedule agent` and `box schedule update`. The level maps to the harness option (`effort` for Claude Code, `modelReasoningEffort` for Codex, `reasoningEffort` for OpenCode) and is validated per harness.
