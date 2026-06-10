---
"@upstash/box": minor
---

Expose cached input tokens in run usage. `run.cost` now includes `cachedInputTokens` (prompt-cache hits, billed at a discounted rate), the streaming `finish` chunk's `usage` carries `cachedInputTokens`, and `RunMetadata`/`BoxRunData` include the backend's `cached_input_tokens` field.
