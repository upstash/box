# Agents

## Before committing

Run `pnpm test` and `pnpm lint` before every commit and fix any issues.

## Changesets

When making changes that affect published packages, write a changeset file using `pnpm changeset`. Prefer **patch** releases since we are on 0.1.0 and a **minor** release would be a breaking change release. Avoid **major** version bumps as much as possible.

## Tests

Write tests for all changes — both unit tests and integration tests. Run `pnpm test` for unit tests and `pnpm test:integration` for integration tests.
