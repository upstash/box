---
"@upstash/box": minor
"@upstash/box-cli": minor
---

Add `wakeOnRequest` to public URLs, and allow init commands on every box.

`box.getPublicURL(port, { wakeOnRequest: true })` marks a public URL so that an
incoming HTTP request resumes a paused box. The request is held until the app's
port is listening, bounded at 30 seconds, so the caller gets the app's own
response instead of an error. It is off by default: anyone who can reach a
wake-enabled URL can start the box and incur compute charges, so pair it with
`bearerToken` or `basicAuth`. The CLI exposes it as `box public-url <port>
--wake-on-request`, and warns when the URL has no authentication.

Init commands are no longer restricted to keep-alive boxes. `Box.create` accepts
`initCommand` without `keepAlive`, and `getInitCommand`, `setInitCommand` and
`deleteInitCommand` work on any box, including a paused one, where the change is
stored and applied on the next resume. The CLI no longer rejects
`--init-command` without `--keep-alive`. The two features are meant to be used
together: the init command is what restarts your app when a request wakes the
box.

`listPublicURLs()` now returns `PublicURLListItem[]` rather than `PublicURL[]`.
The previous type was wrong: the list endpoint returns `id`, `created_at`,
`basic_auth`, `bearer_token` and `wake_on_request`, and never returns the
`token`, `username` or `password` fields the old type advertised, since those
are only returned once at creation.
