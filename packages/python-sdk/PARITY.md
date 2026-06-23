# Parity: `@upstash/box` (JS) ↔ `upstash-box` (Python)

The Python SDK mirrors the TypeScript SDK at `packages/sdk`. This file is the
checklist consulted on every JS change and is enforced by
`scripts/check_parity.py` (symbol-name level).

Naming: JS `camelCase` → Python `snake_case`. JS `Box`/`EphemeralBox` →
Python sync `Box`/`EphemeralBox` (canonical) + async `AsyncBox`/`AsyncEphemeralBox`.
JS `Run`/`StreamRun` → Python `Run`/`StreamRun` (+ `AsyncRun`/`AsyncStreamRun`).

## Module exports

| JS                     | Python                       |
| ---------------------- | ---------------------------- |
| `Box` / `EphemeralBox` | `Box` / `EphemeralBox` (+ `Async*`) |
| `Run` / `StreamRun`    | `Run` / `StreamRun` (+ `Async*`) |
| `BoxError`             | `BoxError`                   |
| `inferDefaultProvider` | `infer_default_provider`     |
| `runCustomHarness`     | `run_custom_harness`         |
| `Agent`, `ClaudeCode`, `OpenAICodex`, `OpenCodeModel`, `OpenRouterModel`, `VercelModel`, `CursorModel`, `BoxApiKey` | same names (str-Enums) |

## `Box` instance methods/properties

| JS                       | Python                      |
| ------------------------ | --------------------------- |
| `agent.run` / `agent.stream` | `agent.run` / `agent.stream` |
| `exec.command` / `code` / `stream` / `streamCode` | `exec.command` / `code` / `stream` / `stream_code` |
| `files.read/write/list/upload/download` | `files.read/write/list/upload/download` |
| `git.clone/diff/status/commit/updateConfig/push/createPR/exec/checkout` | `git.clone/diff/status/commit/update_config/push/create_pr/exec/checkout` |
| `schedule.exec/agent/list/get/pause/resume/delete` | same (snake) |
| `skills.add/remove/list` | `skills.add/remove/list` |
| `cd`, `cwd` | `cd`, `cwd` |
| `configureModel`, `configureCustomHarness`, `modelConfig` | `configure_model`, `configure_custom_harness`, `model_config` |
| `updateNetworkPolicy`, `networkPolicy` | `update_network_policy`, `network_policy` |
| `getStatus`, `pause`, `resume`, `delete` | `get_status`, `pause`, `resume`, `delete` |
| `snapshot`, `listSnapshots`, `deleteSnapshot` | `snapshot`, `list_snapshots`, `delete_snapshot` |
| `getInitCommand`, `setInitCommand`, `deleteInitCommand` | `get_init_command`, `set_init_command`, `delete_init_command` |
| `logs`, `listRuns` | `logs`, `list_runs` |
| `getPublicURL`, `listPublicURLs`, `deletePublicURL` | `get_public_url`, `list_public_urls`, `delete_public_url` |
| `id`, `size`, `keepAlive` | `id`, `size`, `keep_alive` |

## `Box` static methods

| JS | Python |
| -- | ------ |
| `create`, `get`, `getByName`, `list`, `fromSnapshot` | `create`, `get`, `get_by_name`, `list`, `from_snapshot` |
| `delete` (bulk) | `delete_boxes` (renamed to avoid clashing with instance `delete`) |
| `deleteSnapshots` | `delete_snapshots` |
| `setEnv`, `listEnv`, `deleteEnv`, `setAllEnv` | `set_env`, `list_env`, `delete_env`, `set_all_env` |

## `EphemeralBox`

Exposes only `exec`, `files`, `schedule`, `cd`, `cwd`, `network_policy`,
`get_status`, `delete`, `snapshot`, `list_snapshots`, `delete_snapshot`, and
statics `create`, `from_snapshot`, `get_by_name`, `delete_boxes`,
`delete_snapshots`, `expires_at`. **No** `agent`, `git`, or `skills`.
`get_by_name` returns a `Box` (mirrors the JS quirk), not an `EphemeralBox`.

## Intentional exceptions (tracked drift)

| Symbol / behavior | Reason |
| ----------------- | ------ |
| `inferDefaultRunner` (JS) | Deprecated alias of `inferDefaultProvider` — not ported. |
| `getPreviewUrl` / `listPreviews` / `deletePreview` (JS) | Deprecated → use `get_public_url` / `list_public_urls` / `delete_public_url`. |
| `modelConfig.provider` / `.runner` (JS) | Deprecated aliases dropped; Python `model_config` returns `{harness, model}` only. |
| agent config `provider` / `runner` (JS) | Deprecated; Python accepts `harness` only. |
| `Preview` type (JS) | Legacy alias of `PublicURL`; Python exports only `PublicURL`. |
| `response_schema` = Pydantic model or raw dict (Python) | Narrower than JS Zod by design (v1). |
| `close` / `aclose` / context managers (Python) | httpx transport lifecycle — JS has no equivalent (fetch-per-call). |
| `delete_boxes` (Python) | JS static `delete` renamed. |
| timeouts in **milliseconds** | Matches the JS SDK units. |
| agent `options` keys are **snake_case** (Python) vs camelCase (JS) | Pythonic public API; the SDK converts to the backend's per-harness casing (Claude Code / OpenCode → camelCase, Codex → snake_case). |
| `StreamRun.aclose()` needed for `detached` on early break | Python doesn't run generator `finally` on `break` (JS `for await` does). |

## Behavioral quirks mirrored exactly

- Polling loops (2s/300s) in `create`, `from_snapshot`, `snapshot`.
- `is_agent_configured`: `bool(data.agent)` on `create`; `bool(data.model)` on `get`/`from_snapshot`.
- `Run.logs()`: epoch→ISO, **lower-bound-only** time filter.
- `Run.cancel()`: swallows endpoint errors, always sets `cancelled`.
- `files.download` destination: `./{basename}` | `./workspace` | `./{basename(cwd)}`.
- 3-mode run request: file paths → multipart, base64 objects → JSON `files`, else plain JSON.

## Test mapping (JS unit file → Python)

`infer-runner` → `test_infer_provider`; `box-create` → `test_box_create`;
`box-agent-run` + `run` → `test_box_agent_run` + `test_run`;
`box-exec-stream` → `test_box_exec`; `box-files` → `test_box_files`;
`box-git` → `test_box_git`; `box-schedule` → `test_box_schedule`;
`box-skills`/`box-config-model`/`box-preview`/lifecycle/logs → `test_box_misc`;
`box-snapshot`/`box-from-snapshot`/`box-delete-snapshots` → `test_box_snapshot` + `test_box_statics`;
`box-list`/`box-delete`/`box-env` → `test_box_statics`;
`ephemeral-box`(+`from-snapshot`) → `test_ephemeral_box`;
`custom-harness` → `test_custom_harness`; `error` → `test_errors`;
`helpers` → covered by `tests/helpers.py`; `box-instance` → `test_box_instance`;
models → `test_models`; helpers/common → `test_common`. Sync coverage:
`tests/_sync/test_sync_client` + `test_sse_golden`.
