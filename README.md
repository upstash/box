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

## Requirements

- Node.js >= 18
- pnpm

## License

MIT
