---
"@upstash/box-cli": patch
---

`box exec` works with read-only API keys. They may run commands but not stream them, so the output is printed once the command finishes instead of failing with 403.
