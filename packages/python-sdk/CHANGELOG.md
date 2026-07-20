# Changelog

All notable changes to `upstash-box` (Python) are documented here.

## 0.1.3

- Add box labels: `labels` on `Box.create` / `Box.from_snapshot` /
  `EphemeralBox.create` / `EphemeralBox.from_snapshot`, a `label` filter on
  `Box.list`, `labels` on `BoxData`, and a `box.labels` namespace
  (`add` / `remove` / `list`) to manage labels on a running box. Mirrors
  `@upstash/box`.
- Add anonymous client telemetry, following the same header convention as the
  other Upstash SDKs: every API request carries `Upstash-Telemetry-Sdk`,
  `Upstash-Telemetry-Runtime`, and `Upstash-Telemetry-Platform` headers
  describing the SDK version, Python runtime, and deployment platform. No user
  data, request payloads, or identifiers are collected. Disable by setting the
  `UPSTASH_DISABLE_TELEMETRY` environment variable.
- `__version__` moved to `upstash_box/_version.py` (still re-exported from the
  package root).

## 0.1.2

- Add `ClaudeCode.FABLE_5` (`anthropic/claude-fable-5`) to the Claude Code model
  options, mirroring `@upstash/box` 0.5.2.

## 0.1.1

- Add Alpine runtime variants to the `Runtime` type: `node-alpine`,
  `python-alpine`, `golang-alpine`, `ruby-alpine`, `rust-alpine`. Defaults remain
  Debian (glibc); the `-alpine` suffix selects the smaller musl-based image.

## 0.1.0

Initial release — Python port of `@upstash/box`, at parity with the JS SDK as of
`@upstash/box` 0.5.0.

- Async (`AsyncBox`) and sync (`Box`) clients; the sync client is generated from
  the async source via `unasync`.
- Agent `run` / `stream` with streaming chunks, structured output (Pydantic model
  or raw JSON-schema dict), tool callbacks, `max_retries`, timeouts, and webhook
  (fire-and-forget) mode.
- Prompt file attachments: local paths (multipart) and base64 objects (JSON).
- `exec.command` / `code` / `stream` / `stream_code`.
- `files`, `git`, `schedule`, `skills` namespaces.
- Lifecycle: create (with polling), get, list, from_snapshot, delete, pause,
  resume, snapshots, init-command, public URLs, network policy, env management.
- `EphemeralBox` (exec/files/schedule + snapshots).
- Custom harness helper (`run_custom_harness`) emitting the `box-sse-v1` protocol.
- HTTP transport lifecycle: pooled httpx client per box, `close()`/`aclose()` and
  context-manager support.
- Tooling: `scripts/generate_sync.py` (sync codegen) and `scripts/check_parity.py`
  (JS↔Python public-surface parity enforcement).
