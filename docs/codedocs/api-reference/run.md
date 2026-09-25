---
title: "Run"
description: "Represents a single agent or exec execution with status, result, and cost metadata."
---

**Source**: `packages/sdk/src/client.ts`

`Run` encapsulates a single execution. It is returned by `box.agent.run()`, `box.exec.command()`, and `box.exec.code()`. It tracks status, output, exit code, and cost metadata.

## Constructor
`Run` is created internally by the SDK and is not instantiated directly.

## When to use `Run`
Use `Run` when you want a simple request/response model: submit work, wait for completion, and consume the final output. It is a good fit for server-side tasks, cron-like jobs, or background workers where streaming output is not necessary.

## Properties
| Property | Type | Description |
|---------|------|-------------|
| id | `string` | Run ID. Initially local, replaced by backend ID when available. |
| status | `"running" \| "completed" \| "failed" \| "cancelled" \| "detached"` | Final or current status. |
| result | `T` | Final output (typed if `responseSchema` was used). |
| exitCode | `number \| null` | Exit code for exec/code runs. |
| cost | `RunCost` | Token usage and compute time. |

## Methods

### `run.cancel()`
```ts
cancel(): Promise<void>
```
Cancels a running execution and updates status to `cancelled`.

### `run.logs()`
```ts
logs(): Promise<RunLog[]>
```
Fetches structured logs for the time window around this run.

## Example
```ts
import { Box, Agent, ClaudeCode } from "@upstash/box";

const box = await Box.create({
  runtime: "node",
  agent: { provider: Agent.ClaudeCode, model: ClaudeCode.Sonnet_4_5 },
});

const run = await box.exec.command("echo hello");
console.log(run.result); // "hello"

const logs = await run.logs();
console.log(logs.length);

await box.delete();
```

## Example: handle failures and inspect cost
```ts
import { Box, Agent, ClaudeCode } from "@upstash/box";

const box = await Box.create({
  runtime: "node",
  agent: { provider: Agent.ClaudeCode, model: ClaudeCode.Sonnet_4_5 },
});

const run = await box.exec.command("exit 1");
if (run.status === "failed") {
  console.log("Exit code:", run.exitCode);
}
console.log("Compute ms:", run.cost.computeMs);

await box.delete();
```
