---
title: "StreamRun"
description: "Async-iterable Run for streaming output chunks in real time."
---

**Source**: `packages/sdk/src/client.ts`

`StreamRun` extends `Run` and implements `AsyncIterable`, so you can `for await` over output chunks as they arrive. It is returned by `box.agent.stream()`, `box.exec.stream()`, and `box.exec.streamCode()`.

## Constructor
`StreamRun` is created internally by the SDK and is not instantiated directly.

## Properties
All properties of `Run`, plus async iteration support. While streaming, `status` is `"running"`. After iteration finishes, the SDK updates `status` to `"completed"` or `"failed"` depending on the final event and exit code.

## Usage
```ts
import { Box, Agent, ClaudeCode } from "@upstash/box";

const box = await Box.create({
  runtime: "node",
  agent: { provider: Agent.ClaudeCode, model: ClaudeCode.Sonnet_4_5 },
});

const stream = await box.agent.stream({
  prompt: "Refactor the auth flow and explain the changes.",
});

for await (const chunk of stream) {
  if (chunk.type === "text-delta") process.stdout.write(chunk.text);
  if (chunk.type === "finish") console.log("
Tokens:", chunk.usage);
}

await box.delete();
```

## Notes
- If you break out of the loop early, the SDK marks the run as `detached`.
- Call `stream.cancel()` if you want to stop execution explicitly.

## Chunk shapes
Agent streams emit `Chunk` objects with types like `start`, `text-delta`, `tool-call`, `finish`, and `stats`. Exec streams emit `ExecStreamChunk` objects with `output` and `exit` events. In both cases you can treat the stream as a real-time log and update UI or state incrementally.

A common pattern is to buffer `text-delta` into a string, handle `tool-call` events for instrumentation, and read token usage from the final `finish` chunk. For exec streams, you can concatenate `output` chunks and check `exitCode` when the `exit` event arrives.

## Example: capture output incrementally
```ts
import { Box, Agent, ClaudeCode } from "@upstash/box";

const box = await Box.create({
  runtime: "node",
  agent: { provider: Agent.ClaudeCode, model: ClaudeCode.Sonnet_4_5 },
});

const stream = await box.agent.stream({ prompt: "Summarize this repo." });
let output = "";
for await (const chunk of stream) {
  if (chunk.type === "text-delta") output += chunk.text;
  if (chunk.type === "finish") console.log("Final tokens:", chunk.usage);
}

console.log(output.slice(0, 120));
await box.delete();
```
