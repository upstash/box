---
"@upstash/box-cli": patch
---

Give the CLI parity with the SDK, so an agent driving a terminal can reach everything a program can.

- `box browser open|tabs|content|screenshot|act|close|cdp-url`. The browser is the one thing in a box with no shell fallback, because it is driven through the coordinator rather than from inside the container, so `box exec` could never stand in for it. `--tab` is optional while a single tab is open and required once there are several: acting on the wrong page is worse than asking which one. `screenshot` writes to `--out` rather than stdout, which carries text a caller may pipe.
- `box status runs` and `box status logs`. A run id was previously unobtainable, so a failed run could be observed but not investigated.
- `box cancel <run-id>`. `Run.cancel()` only works while holding the object the call returned, which a separate process never is, so an agent that started a long run had no way to stop it.
- `box snapshot list` and `box snapshot delete`.
- `box from-snapshot --no-repl`, matching `box create`: explicit flag, `--json`, or no terminal on either stream. Without it a script could take a snapshot and never restore one, which made listing and deleting them write-only.

- `box schedule exec|agent|list|get|update|pause|resume|delete`. Cron on a box was reachable only from the SDK and the console. `update` sends just the fields named, because a partial update that also sent the command would clear it.
- `box skills add|remove|list`, `box config model|harness|network|init-command`, and `box resume`.
- `box code <source> --lang js|ts|python`, with `-` reading stdin so the shell does not mangle a program on the way in.
- The rest of the browser: `goto`, `observe`, `extract`, `live-url`, and `recordings start|stop|list|get|download`. `extract` takes a flat JSON Schema file, since a Zod schema cannot travel through a command line, and refuses anything nested rather than silently dropping fields.

`exec.session` is deliberately absent: a session is a live WebSocket with `on`/`send`/`close`, and a one-shot command has nowhere to hold it. `getPreviewUrl` and `listPreviews` are deprecated aliases for the public-URL calls, so `box public-url` already covers them.
