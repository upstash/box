# Upstash Box

TypeScript SDK, Python SDK, and CLI for [Upstash Box](https://upstash.com/docs/box) — sandboxed AI coding agents with streaming, structured output, file I/O, git, and snapshots.

## Packages

| Package | Description |
|---------|-------------|
| [`@upstash/box`](./packages/sdk) | TypeScript SDK — programmatic access to the Box API |
| [`upstash-box`](./packages/python-sdk) | Python SDK — sync + async clients, published to PyPI |
| [`@upstash/box-cli`](./packages/cli) | CLI — REPL-first terminal interface wrapping the SDK |

## Quick start

The TypeScript SDK and CLI live in a pnpm workspace:

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Watch mode (both packages)
pnpm dev
```

The Python SDK is a standalone package with its own tooling (it is not part of the
pnpm workspace):

```bash
cd packages/python-sdk
pip install -e ".[dev]"
pytest                       # run the test suite
python scripts/generate_sync.py  # regenerate the sync client from the async source
```

See [`packages/python-sdk/README.md`](./packages/python-sdk/README.md) and its
[`CONTRIBUTING.md`](./packages/python-sdk/CONTRIBUTING.md) for details.

## Repository structure

```
.
├── packages/
│   ├── sdk/          # @upstash/box — TypeScript SDK
│   │   ├── src/
│   │   └── examples/
│   ├── python-sdk/   # upstash-box — Python SDK (sync + async)
│   │   ├── upstash_box/
│   │   ├── examples/
│   │   └── tests/
│   └── cli/          # @upstash/box-cli — CLI + interactive REPL
│       └── src/
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json
```

## Testing

The TypeScript SDK and CLI use [Vitest](https://vitest.dev). There are two test suites:

- **Unit tests** — mock all API calls, fast, no credentials needed
- **Integration tests** — hit the real Box API, require env vars

The Python SDK uses [pytest](https://docs.pytest.org) (with `pytest-asyncio` +
`respx`) and follows the same unit/integration split — integration tests are
gated on `UPSTASH_BOX_API_KEY`. Run it from `packages/python-sdk` with `pytest`.

### Environment variables

Create a `.env` file at the repository root:

```
UPSTASH_BOX_API_KEY=abx_...
AGENT_API_KEY=sk-ant-...
```

Integration tests are automatically skipped when these variables are not set.

### Commands

```bash
# Run all tests (unit + integration if .env is present)
pnpm test

# Run only integration tests
pnpm test:integration

# Run tests for a single package
cd packages/sdk && pnpm test
cd packages/cli && pnpm test
```

## Releasing

The npm packages (`@upstash/box`, `@upstash/box-cli`) and the Python package
(`upstash-box`) version and publish **independently**.

### npm packages

This repo uses [Changesets](https://github.com/changesets/changesets) for versioning and automated npm publishing via OIDC.

#### Stable release

1. Create a changeset while working on your feature:
   ```bash
   pnpm changeset
   ```
2. Merge your PR to `main`. The **Changeset** workflow creates a "Version Packages" PR that bumps versions and updates changelogs.
3. Merge the version PR. The workflow tags the release, creates a GitHub Release, and triggers **npm Publish** which publishes to npm.

#### Canary release

1. Create a branch, make your changes, run `pnpm changeset` to create a changeset, and push the branch to GitHub.
2. Go to **Actions → Canary Release → Run workflow**, pick a package and the branch.
3. The workflow creates a [snapshot version](https://github.com/changesets/changesets/blob/main/docs/snapshot-releases.md) (e.g. `0.2.0-canary-20260219131415-abc1234`), publishes to npm under the `canary` tag, and creates a GitHub prerelease.

### Python package (PyPI)

The Python SDK versions independently of the npm packages (it does not track the
JS SDK version lockstep — see [`packages/python-sdk/RELEASE.md`](./packages/python-sdk/RELEASE.md)).

1. Bump `version` in `packages/python-sdk/pyproject.toml` and `__version__` in `upstash_box/__init__.py`, and update the changelog.
2. Push a tag `python-sdk-v<X.Y.Z>` (matching the package version).
3. The **python-sdk-publish** workflow builds, runs full verification (sync-gen check, ruff, mypy, tests, parity), then publishes via **PyPI Trusted Publishing** (OIDC — no stored token) after approval in the gated `pypi` GitHub Environment.

### Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | PR + push to main | Build and test (Node 18/20/22) |
| `changeset.yml` | Push to main | Version PR or tag + GitHub Release |
| `canary.yml` | Manual dispatch | Snapshot version + GitHub prerelease |
| `npm-publish.yml` | `workflow_run` (after changeset/canary) | Publish to npm with OIDC provenance |
| `python-sdk-ci.yml` | PR + push to main (`packages/python-sdk/**`) | Lint, type-check, and test the Python SDK (3.9–3.14) |
| `python-sdk-publish.yml` | Tag `python-sdk-v*` or manual dispatch | Publish `upstash-box` to PyPI via Trusted Publishing |

`npm-publish.yml` is the sole npm trusted publisher — configure it on npmjs.com for both packages. No npm tokens or PATs required.

## Requirements

- Node.js >= 18 (TypeScript SDK + CLI)
- pnpm
- Python >= 3.9 (Python SDK)

## License

MIT
