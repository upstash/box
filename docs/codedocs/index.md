---
title: "Upstash Box"
description: "Create and control sandboxed AI coding environments with streaming runs, file I/O, git automation, and snapshots."
---

Upstash Box is a TypeScript SDK for creating sandboxed AI coding agents that can run prompts, execute commands, and manipulate files in isolated environments.

**The Problem**
- You need a reproducible coding sandbox with real file systems and shells, not just chat completions.
- Running AI agents in parallel is hard when each task needs its own isolated workspace.
- Automating git workflows (clone, commit, PR) requires stable credentials and a predictable runtime.
- Long-running tasks need snapshots, schedules, and webhooks to avoid blocking your app.

**The Solution**
Upstash Box provides an API-first sandbox that your code can drive. You create a box, run an agent or shell command, stream output, and then persist or discard the environment. The SDK wraps the Box API with typed methods, streaming utilities, and helper abstractions.

```ts filename="quick-solution.ts"
import { Box, Agent, ClaudeCode } from "@upstash/box";

const box = await Box.create({
  runtime: "node",
  agent: { provider: Agent.ClaudeCode, model: ClaudeCode.Sonnet_4_5 },
});

const run = await box.agent.run({
  prompt: "Create a hello-world Express server and explain how to run it.",
});

console.log(run.result);
await box.delete();
```

**Installation**
<Tabs items={["npm", "pnpm", "yarn", "bun"]}>
<Tab value="npm">
```bash
npm install @upstash/box
```
</Tab>
<Tab value="pnpm">
```bash
pnpm add @upstash/box
```
</Tab>
<Tab value="yarn">
```bash
yarn add @upstash/box
```
</Tab>
<Tab value="bun">
```bash
bun add @upstash/box
```
</Tab>
</Tabs>

**Quick start**
```ts filename="quick-start.ts"
import { Box, Agent, ClaudeCode } from "@upstash/box";

const box = await Box.create({
  apiKey: process.env.UPSTASH_BOX_API_KEY,
  runtime: "node",
  agent: {
    provider: Agent.ClaudeCode,
    model: ClaudeCode.Sonnet_4_5,
    apiKey: process.env.CLAUDE_KEY,
  },
});

const run = await box.agent.run({ prompt: "Write a file hello.ts that prints Hello" });
console.log(run.result);

const content = await box.files.read("hello.ts");
console.log(content.slice(0, 80));

await box.delete();
```

Expected output (abridged):
```
File created successfully...
console.log("Hello")
```

**Key features**
- Create long-lived or ephemeral sandboxes with configurable runtime and size.
- Run agents with streaming output and structured results via Zod schemas.
- Execute shell commands or inline code with unified `Run` objects.
- Upload, download, read, and write files with a tracked working directory.
- Automate git workflows: clone, diff, commit, push, and create PRs.
- Schedule recurring prompts or commands with cron and webhook callbacks.

<Cards>
  <Card title="Architecture" href="/docs/architecture">How the SDK is structured internally</Card>
  <Card title="Core Concepts" href="/docs/boxes-and-lifecycle">Learn the Box, Run, and file model</Card>
  <Card title="API Reference" href="/docs/api-reference/box">Explore the full SDK surface</Card>
</Cards>
