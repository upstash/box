---
"@upstash/box-cli": patch
"@upstash/box": patch
---

Reach the parts of a box the CLI could not: the browser, run history, and snapshot restore.

- `box browser open|tabs|content|screenshot|act|close|cdp-url`. The browser is the one thing in a box with no shell fallback, because it is driven through the coordinator rather than from inside the container, so `box exec` could never stand in for it. `--tab` is optional while a single tab is open and required once there are several: acting on the wrong page is worse than asking which one. `screenshot` writes to `--out` rather than stdout, which carries text a caller may pipe.
- `box status runs` and `box status logs`. A run id was previously unobtainable, so a failed run could be observed but not investigated.
- `box cancel <run-id>`, with `Box.cancelRun()` added to the SDK. `Run.cancel()` only works while holding the object the call returned, which a separate process never is, so an agent that started a long run had no way to stop it.
- `box snapshot list` and `box snapshot delete`.
- `box from-snapshot --no-repl`, matching `box create`: explicit flag, `--json`, or no terminal on either stream. Without it a script could take a snapshot and never restore one, which made listing and deleting them write-only.
