---
title: "Helpers"
description: "Utility helpers for inferring agent providers from model strings."
---

**Source**: `packages/sdk/src/client.ts`

The SDK exports a small set of helper functions that make model configuration easier. These helpers are useful when you receive model strings dynamically and want a provider inferred automatically.

## `inferDefaultProvider`
```ts
inferDefaultProvider(model: string): Agent
```

Infers the agent provider based on the model prefix:
- `openrouter/` → `Agent.ClaudeCode`
- `opencode/` → `Agent.OpenCode`
- `openai/` → `Agent.Codex`
- otherwise defaults to `Agent.ClaudeCode`

**Example**
```ts
import { inferDefaultProvider, Agent } from "@upstash/box";

const provider = inferDefaultProvider("openai/gpt-5.3-codex");
console.log(provider === Agent.Codex); // true
```

## When to use it
If you store models as strings in a database or configuration file, `inferDefaultProvider` helps you avoid duplicating a separate provider field. It is also useful when migrating older code that used the `runner` field in `AgentConfig`, because you can infer the provider and pass it explicitly.

The inference is intentionally simple. It only checks string prefixes and falls back to `Agent.ClaudeCode` for unknown patterns. If you use a custom provider string, pass `provider` explicitly rather than relying on inference.

If you are integrating with OpenRouter, the model names begin with `openrouter/`, which maps to `Agent.ClaudeCode` in this SDK. That is intentional because OpenRouter is routed through the Claude Code agent on the backend. When in doubt, set `provider` explicitly to remove ambiguity.

This keeps configuration predictable.

It also simplifies migrations.

Use it sparingly.

## `inferDefaultRunner`
```ts
inferDefaultRunner(model: string): Agent
```

Deprecated alias for `inferDefaultProvider`. Use the new function name when possible.

**Example**
```ts
import { inferDefaultRunner } from "@upstash/box";

const provider = inferDefaultRunner("opencode/claude-sonnet-4-5");
console.log(provider);
```

## Example: wiring inference into Box.create
```ts
import { Box, Agent, inferDefaultProvider } from "@upstash/box";

const model = "openrouter/anthropic/claude-opus-4-5";
const provider = inferDefaultProvider(model);

const box = await Box.create({
  runtime: "node",
  agent: { provider, model },
});
```
