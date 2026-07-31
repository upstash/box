---
"@upstash/box-pi": patch
---

adds zod as a direct dependency. `pi install` skips peer dependencies, so @upstash/box's zod peer was never installed and the extension failed to load with "Cannot find module 'zod/v3'".
