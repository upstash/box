---
"@upstash/box-cli": patch
---

fix: make CLI self-contained so global install (`pnpm add -g`) works

Move `@upstash/box` from `peerDependencies` to `dependencies` and add `zod` as a direct dependency. When installed globally via pnpm, peer dep resolution could pick up an older `zod` (e.g. `3.24.2`) from the shared global store, which lacks the `zod/v3` subpath that `zod-to-json-schema@^3.25.1` requires, causing `ERR_PACKAGE_PATH_NOT_EXPORTED` on startup.
