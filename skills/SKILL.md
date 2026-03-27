---
name: upstash-box-js
description: Work with the @upstash/box SDK for sandboxed cloud containers with AI agents, shell, filesystem, and git. Use when building with Upstash Box, creating sandboxed environments, running AI agents in containers, or orchestrating parallel boxes.
---

# @upstash/box SDK

Sandboxed cloud containers with built-in AI agents, shell, filesystem, and git.

## Install & Setup

```bash
npm install @upstash/box
```

Set `UPSTASH_BOX_API_KEY` env var or pass `apiKey` to constructors.

## Box Lifecycle

```ts
import { Box, Agent, ClaudeCode, BoxApiKey } from "@upstash/box"

// Create with agent + git + env vars
const box = await Box.create({
  runtime: "node", // "node" | "python" | "golang" | "ruby" | "rust"
  agent: {
    provider: Agent.ClaudeCode, // Agent.Codex | Agent.OpenCode
    model: ClaudeCode.Sonnet_4_5,
    // apiKey options:
    //   omit          → server decides which key to use
    //   BoxApiKey.UpstashKey  → use Upstash-provided LLM key
    //   BoxApiKey.StoredKey   → use key previously stored via Upstash Console
    //   "sk-..."      → direct API key string
    apiKey: BoxApiKey.UpstashKey,
  },
  git: { // all fields optional
    token: process.env.GITHUB_TOKEN, // alternatively link your GitHub account via Upstash Console
    userName: "Bot",
    userEmail: "bot@example.com",
  },
  env: { DATABASE_URL: "..." },
  skills: ["upstash/qstash-js"], // GitHub repos as agent skills
})

// Reconnect, list, delete, pause/resume
const same = await Box.get(box.id)
const all = await Box.list()
await box.pause()
await box.resume()
await box.delete()  // irreversible
const { status } = await box.getStatus()
```

## Agent Runs

```ts
import { z } from "zod"

// Structured output with Zod schema
const run = await box.agent.run({
  prompt: "Review the code for security issues",
  responseSchema: z.object({
    verdict: z.enum(["approved", "changes_requested"]),
    findings: z.array(z.object({
      severity: z.enum(["high", "medium", "low"]),
      file: z.string(),
      issue: z.string(),
    })),
  }),
  timeout: 120_000,
  maxRetries: 2,
  onToolUse: (tool) => console.log(tool.name, tool.input),
})

run.status  // "running" | "completed" | "failed" | "cancelled" | "detached"
run.result  // typed from schema
run.cost    // { inputTokens, outputTokens, computeMs, totalUsd }

// Streaming
const stream = await box.agent.stream({
  prompt: "Build a REST API",
})
for await (const chunk of stream) { console.log(chunk) }

// Fire-and-forget with webhook
await box.agent.run({
  prompt: "Run tests",
  webhook: { url: "https://example.com/hook", headers: { Authorization: "Bearer ..." } },
})
```

## Run Fields

Every `run` (agent, command, or code) returns a `Run<T>`:

```ts
const run = await box.exec.command("npm test")
run.id        // run ID
run.status    // "completed" | "failed" | ...
run.result    // string output (or typed T with responseSchema)
run.exitCode  // number | null (null for agent runs)
run.cost      // { inputTokens, outputTokens, computeMs, totalUsd }

await run.cancel()          // cancel a running run
const logs = await run.logs() // [{ timestamp, level, message }]
```

## Shell Execution

```ts
// Run commands
const run = await box.exec.command("echo hello && ls -la")

// Run code snippets — lang: "js" | "ts" | "python"
const run2 = await box.exec.code({ code: "console.log(1+1)", lang: "js", timeout: 10_000 })

// Streaming shell
const stream = await box.exec.stream("npm run build")
for await (const chunk of stream) {
  // chunk: { type: "output", data } | { type: "exit", exitCode, cpuNs }
}
```

## Filesystem

```ts
await box.files.write({ path: "/workspace/home/app.js", content: "console.log('hi')" })
const content = await box.files.read("/workspace/home/app.js")
const entries = await box.files.list("/workspace/home") // [{ name, path, size, is_dir, mod_time }]

// Binary files — use encoding: "base64" for read and write
await box.files.write({ path: "/workspace/home/image.png", content: base64String, encoding: "base64" })
const b64 = await box.files.read("/workspace/home/image.png", { encoding: "base64" })

// Upload local files, download box files
await box.files.upload([{ path: "./local/file.txt", destination: "/workspace/home/file.txt" }])
await box.files.download({ folder: "./output" })
```

## cd / Working Directory

The SDK tracks `cwd` client-side. All operations (exec, files, git, agent) run relative to it.

```ts
box.cwd // current working directory (starts at /workspace/home)
await box.cd("my-repo")     // relative to current cwd
await box.cd("/workspace/home/other") // absolute path
```

## Git

```ts
await box.git.clone({ repo: "github.com/org/repo", branch: "main" })
await box.cd("repo") // cd into cloned repo

const status = await box.git.status()
const diff = await box.git.diff()
const { sha } = await box.git.commit({ message: "fix: resolve bug" })
await box.git.push({ branch: "feature/fix" })

await box.git.checkout({ branch: "release/v2" })
const pr = await box.git.createPR({ title: "Fix bug", body: "...", base: "main" })
// pr: { url, number, title, base }

// Arbitrary git commands
const { output } = await box.git.exec({ args: ["log", "--oneline", "-5"] })
```

## Snapshots

```ts
// Snapshot — checkpoint workspace state
const snap = await box.snapshot({ name: "after-setup" })
// snap: { id, name, box_id, size_bytes, status, created_at }

const restored = await Box.fromSnapshot(snap.id)
const snaps = await box.listSnapshots()
await box.deleteSnapshot(snap.id)

```

## EphemeralBox

Lightweight, short-lived boxes (max 3 days). No agent or git. Supports exec, files, cd, and snapshots only.

```ts
import { EphemeralBox } from "@upstash/box"

const ebox = await EphemeralBox.create({
  runtime: "python",
  ttl: 3600,  // seconds, max 259200 (3 days)
  env: { API_KEY: "..." },
})

ebox.expiresAt // unix timestamp when auto-deleted
await ebox.exec.command("python -c 'print(1+1)'")
await ebox.exec.code({ code: "print('hi')", lang: "python" })
await ebox.files.write({ path: "/workspace/home/data.json", content: "{}" })
await ebox.cd("subdir")
await ebox.delete()

// Restore from snapshot
const ebox2 = await EphemeralBox.fromSnapshot(snap.id, { ttl: 7200 })
```

## Preview URLs

Expose box ports as public URLs with optional auth.

```ts
const preview = await box.getPreviewUrl(3000)
// preview: { url: "https://{id}-3000.preview.box.upstash.com", port }

const authed = await box.getPreviewUrl(3000, { bearerToken: true })
// authed: { url, port, token }

const basic = await box.getPreviewUrl(3000, { basicAuth: true })
// basic: { url, port, username, password }

const { previews } = await box.listPreviews()
await box.deletePreview(3000)
```

## MCP Servers

Attach MCP servers to the box agent.

```ts
const box = await Box.create({
  agent: { provider: Agent.ClaudeCode, model: ClaudeCode.Sonnet_4_5 },
  mcpServers: [
    { name: "fs", package: "@modelcontextprotocol/server-filesystem" },
    { name: "custom", url: "https://mcp.example.com/sse", headers: { Authorization: "..." } },
  ],
})
```

## Gotchas

- Default working directory is `/workspace/home`, not `/home` or `/`
- `box.cd()` is client-side tracking — it validates the path exists but doesn't change the box's shell cwd. All SDK methods use it automatically.
- `EphemeralBox` does NOT support `agent`, `git`, or `preview` — use full `Box` for those
- `run.exitCode` is `null` for agent runs, only available for exec commands
- `box.delete()` is irreversible — snapshot first if you need the state
- Git operations require `git.token` in `BoxConfig` for private repos and PRs
- `Box.fromSnapshot()` creates a new box — it does not modify the original
