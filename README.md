# Upstash Box

TypeScript SDK and CLI for [Upstash Box](https://upstash.com/docs/box) — sandboxed AI coding agents with streaming, structured output, file I/O, git, and snapshots.

## Packages

| Package | Description |
|---------|-------------|
| [`@buggyhunter/box`](./packages/sdk) | TypeScript SDK — programmatic access to the Box API |
| [`@upstash/box-cli`](./packages/cli) | CLI — REPL-first terminal interface wrapping the SDK |

## Quick start

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Watch mode (both packages)
pnpm dev
```

## Repository structure

```
.
├── packages/
│   ├── sdk/          # @buggyhunter/box — TypeScript SDK
│   │   ├── src/
│   │   └── examples/
│   └── cli/          # @upstash/box-cli — CLI + interactive REPL
│       └── src/
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── package.json
```

## Testing

Tests use [Vitest](https://vitest.dev). There are two test suites:

- **Unit tests** — mock all API calls, fast, no credentials needed
- **Integration tests** — hit the real Box API, require env vars

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

## Requirements

- Node.js >= 18
- pnpm

## License

MIT
