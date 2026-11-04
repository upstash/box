---
"@upstash/box": minor
"@upstash/box-cli": minor
---

Upstash no longer provides model API keys for agents. Agent runs use the key set on the box, or else the key saved on your account; a run with neither fails with `agent API key is required`.

- `BoxApiKey.UpstashKey` is deprecated. The server treats it like an omitted key. Use `BoxApiKey.StoredKey` or pass your own key.
- `use_managed_key` on box data is deprecated and is always false.
- CLI: the create wizard drops the "Upstash-managed" option; an empty custom key falls back to the stored key.
