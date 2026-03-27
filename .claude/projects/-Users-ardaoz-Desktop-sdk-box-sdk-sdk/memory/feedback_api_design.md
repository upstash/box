---
name: API design preferences
description: User prefers separate methods over overloaded signatures, and merged parameter objects over multiple params
type: feedback
---

Prefer separate methods over overloaded/union parameter signatures. e.g. `delete()` + `deleteAll()` rather than `delete({ all: true } | { boxIds: ... })`.

Also prefer merging target and options into a single parameter object rather than having `(target, options?)` signatures.

**Why:** Cleaner API surface, easier to understand at call site.
**How to apply:** When designing SDK methods, use distinct method names for distinct behaviors. Combine all options into one parameter object.
