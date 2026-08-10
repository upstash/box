---
"@upstash/box": patch
---

fix: send git userName/userEmail in Box.fromSnapshot

`Box.fromSnapshot` forwarded only `git.token` and silently dropped
`git.userName` and `git.userEmail`, so boxes restored from a snapshot fell
back to the server's default git identity (`Upstash Box <box@upstash.com>`)
even when the caller configured one. The from-snapshot endpoint already
accepts `git_user_name`/`git_user_email`; the SDK now sends them like
`Box.create` does.
