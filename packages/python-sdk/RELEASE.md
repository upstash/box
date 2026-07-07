# Releasing upstash-box (Python)

## Versioning policy

The Python SDK versions **independently** on PyPI — it does **not** track the JS
SDK (`@upstash/box`) version numbers lockstep. The JS SDK is at 0.5.0; this
package starts fresh at **0.1.0**.

Each release records the JS feature level it reached parity with:

| upstash-box (PyPI) | parity as of `@upstash/box` |
| ------------------ | --------------------------- |
| 0.1.0              | 0.5.0                       |
| 0.1.2              | 0.5.2                       |

When a JS feature is mirrored, bump the Python patch/minor version and update the
row above (and `__version__` in `upstash_box/__init__.py` + `version` in
`pyproject.toml`).

## Publishing

Releases are **not** auto-published from `main`. The publish flow is gated by the
`pypi` GitHub Environment (configure it with required reviewers).

### Preferred: tag-triggered CI release

`.github/workflows/python-sdk-publish.yml` builds, runs the full verification
(generation check, ruff, mypy, tests, parity), checks the tag matches the package
version, then publishes via **PyPI Trusted Publishing** (OIDC — no stored token)
after environment approval.

```bash
# 1. bump version in pyproject.toml + upstash_box/__init__.py, update CHANGELOG
# 2. tag and push:
git tag python-sdk-v0.1.0
git push origin python-sdk-v0.1.0
# 3. approve the `pypi` environment in the Actions run
```

One-time setup: register a PyPI Trusted Publisher for `upstash-box` pointing at
this workflow (or set a `PYPI_API_TOKEN` secret and switch the publish step to use
it). The `workflow_dispatch` trigger supports a `dry_run` build-and-verify run.

### Manual fallback

```bash
cd packages/python-sdk
python scripts/generate_sync.py
git diff --exit-code -- upstash_box/_sync   # generation up to date
ruff check . && mypy upstash_box
pytest tests/_async tests/_sync
python scripts/check_parity.py               # JS<->Python parity (needs Node)
python -m build                              # builds sdist + wheel into dist/
python -m twine upload dist/*                # requires PyPI credentials
```

Tag the release `python-sdk-vX.Y.Z`.
