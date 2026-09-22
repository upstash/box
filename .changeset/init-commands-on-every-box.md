---
"@upstash/box": minor
"@upstash/box-cli": patch
---

Allow init commands on every box, and correct the public URL list type.

Init commands are no longer restricted to keep-alive boxes. `Box.create` accepts
`initCommand` without `keepAlive`, and `getInitCommand`, `setInitCommand` and
`deleteInitCommand` work on any box, including a paused one, where the change is
stored and applied on the next resume. The CLI no longer rejects
`--init-command` without `--keep-alive`.

This matters because a public URL now resumes a paused box on any request and
holds the request until the app's port is listening. The init command is what
restarts the app when that happens, so the two go together.

`listPublicURLs()` now returns `PublicURLListItem[]` rather than `PublicURL[]`.
The previous type was wrong: the list endpoint returns `id`, `created_at`,
`basic_auth` and `bearer_token`, and never returns the `token`, `username` or
`password` fields the old type advertised, since those are only returned once at
creation.
