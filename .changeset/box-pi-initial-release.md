---
"@upstash/box-pi": minor
---

Initial release of the Upstash Box extension for the Pi coding agent. The agent
runs locally while `bash`, file I/O, and search execute inside a remote Box:
one box per Pi session (idle-paused, reattached on resume, reaped when the
session is deleted), per-session GitHub branch sync with automatic pushes,
`/sandbox` `/github` `/compare` `/merge` `/pr` commands, and a `preview_url`
tool with basic-auth protected preview links. Launch with `pi --box`.
