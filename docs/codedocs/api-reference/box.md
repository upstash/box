---
title: "Box"
description: "Create and manage durable sandboxed boxes with agents, exec, files, git, schedules, and snapshots."
---

**Source**: `packages/sdk/src/client.ts`

The `Box` class is the primary SDK surface. It represents a sandboxed workspace with a runtime, filesystem, and optional AI agent. You create a Box with `Box.create()` or reconnect to one with `Box.get()`.

## Constructor (static)
```ts
static create<TProvider = unknown>(config?: BoxConfig): Promise<Box<TProvider>>
```

**BoxConfig parameters**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| apiKey | `string` | `process.env.UPSTASH_BOX_API_KEY` | API key for Box authentication. |
| baseUrl | `string` | `https://us-east-1.box.upstash.com` | Base URL for the Box API. |
| name | `string` | — | Human-readable name for the box. |
| runtime | `"node" \| "python" \| "golang" \| "ruby" \| "rust"` | — | Runtime environment for the box. |
| size | `"small" \| "medium" \| "large"` | `"small"` | Resource size preset. |
| agent | `AgentConfig` | — | Agent provider/model configuration. |
| git | `{ token?: string; userName?: string; userEmail?: string }` | — | GitHub token and optional git identity. |
| env | `Record<string, string>` | — | Environment variables injected into the box. |
| attachHeaders | `Record<string, Record<string, string>>` | — | Secret headers injected into outbound HTTPS requests. |
| networkPolicy | `NetworkPolicy` | `{ mode: "allow-all" }` | Outbound network access policy. |
| skills | `string[]` | — | Skills to enable (owner/repo paths). |
| mcpServers | `McpServerConfig[]` | — | MCP servers to attach. |
| timeout | `number` | `600000` | Request timeout in milliseconds. |
| debug | `boolean` | `false` | Enable debug logging. |

**Example**
```ts
import { Box, Agent, ClaudeCode } from "@upstash/box";

const box = await Box.create({
  runtime: "node",
  agent: { provider: Agent.ClaudeCode, model: ClaudeCode.Sonnet_4_5 },
  env: { NODE_ENV: "production" },
});
```

## Static methods

### `Box.get()`
```ts
static get<TProvider = unknown>(boxId: string, options?: BoxGetOptions): Promise<Box<TProvider>>
```
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| boxId | `string` | — | Box ID to reconnect to. |
| options.apiKey | `string` | `process.env.UPSTASH_BOX_API_KEY` | API key. |
| options.baseUrl | `string` | `https://us-east-1.box.upstash.com` | API base URL. |
| options.gitToken | `string` | — | GitHub token used for git operations. |
| options.timeout | `number` | `600000` | Request timeout. |
| options.debug | `boolean` | `false` | Enable debug logging. |

### `Box.getByName()`
```ts
static getByName<TProvider = unknown>(name: string, options?: BoxGetOptions): Promise<Box<TProvider>>
```
Alias for `Box.get()` in this SDK version (name is treated as ID by the backend).

### `Box.list()`
```ts
static list(options?: ListOptions): Promise<BoxData[]>
```

### `Box.delete()`
```ts
static delete(options: BoxConnectionOptions & { boxIds: string | string[] }): Promise<void>
```

### `Box.fromSnapshot()`
```ts
static fromSnapshot<TProvider = unknown>(snapshotId: string, config?: BoxConfig): Promise<Box<TProvider>>
```

## Instance namespaces

### `box.agent`
```ts
run<T>(options: RunOptions<T, TProvider>): Promise<Run<T | string>>
stream(options: StreamOptions<TProvider>): Promise<StreamRun<string, Chunk>>
```

### `box.exec`
```ts
command(command: string): Promise<Run<string>>
code(options: CodeExecutionOptions): Promise<Run<string>>
stream(command: string): Promise<StreamRun<string, ExecStreamChunk>>
streamCode(options: CodeExecutionOptions): Promise<StreamRun<string, ExecStreamChunk>>
```

### `box.files`
```ts
read(path: string, options?: { encoding?: "base64" }): Promise<string>
write(options: { path: string; content: string; encoding?: "base64" }): Promise<void>
list(path?: string): Promise<FileEntry[]>
upload(files: UploadFileEntry[]): Promise<void>
download(options?: { folder?: string }): Promise<void>
```

### `box.git`
```ts
clone(options: GitCloneOptions): Promise<void>
diff(): Promise<string>
status(): Promise<string>
commit(options: GitCommitOptions): Promise<GitCommitResult>
updateConfig(options: GitConfigUpdateOptions): Promise<GitConfig>
push(options?: { branch?: string }): Promise<void>
createPR(options: GitPROptions): Promise<PullRequest>
exec(options: GitExecOptions): Promise<GitExecResult>
checkout(options: GitCheckoutOptions): Promise<void>
```

### `box.schedule`
```ts
exec(options: ExecScheduleOptions): Promise<Schedule>
agent(options: AgentScheduleOptions<TProvider>): Promise<Schedule>
list(): Promise<Schedule[]>
get(id: string): Promise<Schedule>
pause(id: string): Promise<void>
resume(id: string): Promise<void>
delete(id: string): Promise<void>
```

### `box.skills`
```ts
add(skillId: string): Promise<void>
remove(skillId: string): Promise<void>
list(): Promise<string[]>
```

## Lifecycle and config

### `box.cd()`
```ts
cd(path: string): Promise<void>
```
Changes the SDK-tracked working directory after verifying the path exists.

### `box.getStatus()`
```ts
getStatus(): Promise<{ status: string }>
```

### `box.configureModel()`
```ts
configureModel(model: string): Promise<void>
```

### `box.updateNetworkPolicy()`
```ts
updateNetworkPolicy(policy: NetworkPolicy): Promise<void>
```

### `box.pause()` / `box.resume()` / `box.delete()`
```ts
pause(): Promise<void>
resume(): Promise<void>
delete(): Promise<void>
```

## Snapshots
```ts
snapshot(options: { name: string }): Promise<Snapshot>
listSnapshots(): Promise<Snapshot[]>
deleteSnapshot(snapshotId: string): Promise<void>
```

## Logs and runs
```ts
logs(options?: { offset?: number; limit?: number }): Promise<LogEntry[]>
listRuns(): Promise<BoxRunData[]>
```

## Previews
```ts
getPreviewUrl(port: number, options?: { bearerToken?: boolean; basicAuth?: boolean }): Promise<Preview>
listPreviews(): Promise<{ previews: Preview[] }>
deletePreview(port: number): Promise<void>
```

## Example: Combine agent + git + files
```ts
import { Box, Agent, ClaudeCode } from "@upstash/box";

const box = await Box.create({
  runtime: "node",
  agent: { provider: Agent.ClaudeCode, model: ClaudeCode.Sonnet_4_5 },
  git: { token: process.env.GITHUB_TOKEN },
});

await box.git.clone({ repo: "https://github.com/example/project" });
await box.agent.run({ prompt: "Add a CONTRIBUTING.md file" });
const diff = await box.git.diff();
console.log(diff.slice(0, 200));

await box.delete();
```
