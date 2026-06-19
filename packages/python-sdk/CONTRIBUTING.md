# Contributing to upstash-box (Python)

This SDK mirrors the TypeScript SDK at `packages/sdk`. The async client is the
**single source of truth**; the sync client is generated from it.

## Golden rule: edit `_async/`, never `_sync/`

```
upstash_box/_async/client.py   <- edit here (source of truth)
upstash_box/_async/_sse.py     <- edit here
upstash_box/_sync/*            <- GENERATED, do not edit
upstash_box/_sync/_fallbacks.py <- the one hand-written sync file
```

After any change under `_async/`, regenerate:

```bash
python scripts/generate_sync.py
```

CI fails if `_sync/` is out of date:

```bash
python scripts/generate_sync.py && \
  git diff --exit-code -- packages/python-sdk/upstash_box/_sync
```

## Generation-safe style for `_async/`

The sync client is produced by `unasync` token substitution. Keep the async code
mechanical so it transforms cleanly:

- Use `await`, `async def`, `async for`, `async with` directly (these are
  rewritten). Do **not** use `asyncio.gather`, `asyncio.TaskGroup`, or event-loop
  APIs in the substitutable path — they have no sync equivalent.
- For sleeping/polling use `asyncio.sleep(...)` (rewritten to `time.sleep`).
  Never call event-loop-specific timing APIs.
- For HTTP use the `httpx` async spellings the generator knows:
  `AsyncClient`, `aiter_bytes`, `aread`, `aclose`, `send(..., stream=True)`,
  `build_request`. These map to `Client`, `iter_bytes`, `read`, `close`, etc.
- Streaming context managers: prefer `send(request, stream=True)` + explicit
  `aclose()` in a `finally` over `async with client.stream(...)` — the latter
  breaks when a consumer `break`s out of a wrapping generator.
- If a construct genuinely can't be generated, implement the sync version in
  `upstash_box/_sync/_fallbacks.py` (the generator never touches it) and import
  it from the generated client. Do not hand-edit other `_sync/` files.

Renamed tokens are configured in `scripts/generate_sync.py`
(`AsyncBox`->`Box`, `AsyncRun`->`Run`, `asyncio`->`time`, etc.).

## Mirroring a JS change

When a feature lands in `packages/sdk`:

1. Add it to `upstash_box/_async/client.py` (and `types.py` / `_common.py` as
   needed), following the existing method-per-endpoint pattern.
2. `python scripts/generate_sync.py`.
3. Add an async unit test under `tests/_async/` and a sync happy-path test under
   `tests/_sync/` if it touches streaming/transport.
4. Add a `PARITY.md` row.
5. Run the checks below.

## Tests

Tests are **handwritten, not generated** (generating pytest tests fights with
`@pytest.mark.asyncio` and respx async/sync differences).

- `tests/_async/` — full unit suite (source of truth), respx-mocked.
- `tests/_sync/` — thinner handwritten suite against the generated `Box`, plus
  the unasync risk areas (streaming/cancel/detached/failed/multipart/polling) and
  the SSE golden-file equality test.
- `tests/integration/` — real-API, gated on `UPSTASH_BOX_API_KEY`.

## Pre-commit hooks (optional)

A package-scoped pre-commit config lives at the repo root. It runs ruff
(check + format) and regenerates `_sync/` on changes to `_async/`, using the
tools from this package's dev env. Enable it once:

```bash
pip install -e "packages/python-sdk[dev]"   # provides ruff + unasync
pip install pre-commit && pre-commit install
```

The hooks only touch `packages/python-sdk/**` — JS commits are unaffected.

## Checks before committing

```bash
python scripts/generate_sync.py
ruff check . && ruff format --check .
mypy upstash_box                         # type check (generated _sync excluded)
pytest tests/_async tests/_sync          # unit, no network
python scripts/check_parity.py           # needs Node
git diff --exit-code -- packages/python-sdk/upstash_box/_sync
```
