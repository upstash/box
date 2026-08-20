---
"@upstash/box": patch
---

Add `box.exec.session()` — a live, interactive command session over a WebSocket.

Unlike `exec.command` / `exec.stream`, which run a command and hand back its
result, a session returns a handle to a *running* process:

- `argv` runs a program directly (no shell); `cmd` runs one via `bash -lc`.
- `write()` sends stdin, `endStdin()` closes it so a command reading to EOF can
  finish, and `onStdout` / `onStderr` receive output as it arrives (separate
  streams unless `tty` is set).
- `tty` allocates a real PTY sized by `rows`/`cols`, with `resize()` for later
  changes — enough for interactive programs and terminal UIs.
- `kill(signal)` sends an allowlisted signal; `terminate(graceMs)` asks the
  server for SIGTERM then SIGKILL after the grace.
- `wait()` resolves with the exit code; `close()` hangs up, which also stops the
  process.

Node-only: authentication uses a request header, which browsers cannot set on a
WebSocket handshake. `ws` moves from a dev dependency to a runtime dependency;
the public types stay free of `@types/ws`.
