---
"@upstash/dsh-box": minor
---

Add `@upstash/dsh-box`, a DeepSeek Harness provider that runs the harness's
subprocess seam inside a remote Upstash Box. The harness stays local; only the
process world moves, so `dsh-bash-local` and anything else built on
`ctx.subprocess` execute in the box without a fork.

The package ships two plugins behind one bundle: `@upstash/dsh-box` owns the box
lifecycle as `ctx.box`, and `@upstash/dsh-box/subprocess` implements the seam as
`ctx.subprocess`. `dsh plugin add @upstash/dsh-box` mounts both.

Covers `spawn`, `resolveExecutable`, bounded collect readers, and tree-scoped
termination. `spawnTerminal`, `inherit` output, spill files, and a filesystem
adapter are not implemented yet.

Environment entries cross into the box only when a spawn asks for them
explicitly, so host ambient values never reach a remote process implicitly.
