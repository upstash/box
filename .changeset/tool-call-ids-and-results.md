---
"@upstash/box": minor
---

Add `toolCallId` to `tool-call` chunks and add a new `tool-result` chunk variant to the streaming `Chunk` union. This lets consumers reliably match results back to their originating call when an agent runs multiple tools in parallel, and removes the need to intercept `tool_result` from the `unknown` event variant.
