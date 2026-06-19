# Agents

## Before committing

Run `pnpm test` and `pnpm lint` before every commit and fix any issues.

## Changesets

When making changes that affect published packages, write a changeset file using `pnpm changeset`. Prefer **patch** releases since we are on 0.1.0 and a **minor** release would be a breaking change release. Avoid **major** version bumps as much as possible.

## Tests

Write tests for all changes — both unit tests and integration tests. Run `pnpm test` for unit tests and `pnpm test:integration` for integration tests.

## Python SDK (`packages/python-sdk`)

The Python SDK (`upstash-box`) mirrors the JS SDK (`packages/sdk`). The **async**
client (`upstash_box/_async/`) is the single source of truth; the **sync** client
(`upstash_box/_sync/`) is generated — never hand-edit it. See
`packages/python-sdk/CONTRIBUTING.md`.

When mirroring a JS change: edit `_async/`, then from `packages/python-sdk`:

```bash
python scripts/generate_sync.py          # regenerate the sync client
ruff check . && ruff format --check .
pytest tests/_async tests/_sync          # unit tests (no network)
python scripts/check_parity.py           # JS<->Python parity (needs Node)
git diff --exit-code -- upstash_box/_sync # generation up to date
```

Add an async unit test (+ a sync happy-path test for streaming/transport), a
`PARITY.md` row, and a `CHANGELOG.md` entry. Integration tests are opt-in:
`pytest -m integration` with `UPSTASH_BOX_API_KEY` set.
