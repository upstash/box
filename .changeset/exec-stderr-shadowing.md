---
"@upstash/box": patch
---

Fix `exec.command()` and `exec.code()` discarding stdout whenever the process wrote anything to stderr. Previously `run.result` returned stderr instead of stdout even on exit code 0, so a successful command that emitted a single warning (apt, git, bun, and most CLIs routinely do) lost its entire stdout. `run.result` is now stdout on success and stderr (falling back to stdout) on failure, and `Run` exposes new `stdout` and `stderr` getters with the raw streams.

Behavioral change on the success path: if a command exits 0 and writes only to stderr, `run.result` is now `""` instead of the stderr text — read `run.stderr` for it.
