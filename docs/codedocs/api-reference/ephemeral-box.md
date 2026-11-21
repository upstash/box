---
title: "EphemeralBox"
description: "Create short-lived boxes optimized for exec and file operations."
---

**Source**: `packages/sdk/src/client.ts`

`EphemeralBox` is a lightweight wrapper around `Box` for short-lived tasks. It exposes exec, files, schedules, and lifecycle methods, but excludes agent and git operations.

## Constructor (static)
```ts
static create(config?: EphemeralBoxConfig): Promise<EphemeralBox>
```

**EphemeralBoxConfig parameters**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| apiKey | `string` | `process.env.UPSTASH_BOX_API_KEY` | API key for Box authentication. |
| baseUrl | `string` | `https://us-east-1.box.upstash.com` | API base URL. |
| name | `string` | — | Human-readable name. |
| runtime | `"node" \| "python" \| "golang" \| "ruby" \| "rust"` | — | Runtime environment. |
| size | `"small" \| "medium" \| "large"` | `"small"` | Resource size preset. |
| ttl | `number` | `259200` | Time-to-live in seconds (max 3 days). |
| env | `Record<string, string>` | — | Environment variables for the box. |
| attachHeaders | `Record<string, Record<string, string>>` | — | Secret outbound headers. |
| networkPolicy | `NetworkPolicy` | `{ mode: "allow-all" }` | Outbound network policy. |
| timeout | `number` | `600000` | Request timeout. |
| debug | `boolean` | `false` | Enable debug logging. |

## Static methods

### `EphemeralBox.fromSnapshot()`
```ts
static fromSnapshot(snapshotId: string, config?: EphemeralBoxConfig): Promise<EphemeralBox>
```

### `EphemeralBox.getByName()`
```ts
static getByName(name: string, options?: BoxGetOptions): Promise<Box>
```

### `EphemeralBox.delete()`
```ts
static delete(options: BoxConnectionOptions & { boxIds: string | string[] }): Promise<void>
```

## Instance namespaces

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

### `box.schedule`
```ts
exec(options: ExecScheduleOptions): Promise<Schedule>
agent(options: AgentScheduleOptions): Promise<Schedule>
list(): Promise<Schedule[]>
get(id: string): Promise<Schedule>
pause(id: string): Promise<void>
resume(id: string): Promise<void>
delete(id: string): Promise<void>
```

## Lifecycle
```ts
cd(path: string): Promise<void>
getStatus(): Promise<{ status: string }>
delete(): Promise<void>
snapshot(options: { name: string }): Promise<Snapshot>
listSnapshots(): Promise<Snapshot[]>
deleteSnapshot(snapshotId: string): Promise<void>
```

## Example
```ts
import { EphemeralBox } from "@upstash/box";

const box = await EphemeralBox.create({ runtime: "node", ttl: 3600 });
const run = await box.exec.command("node -e 'console.log(1+1)'");
console.log(run.result);
await box.delete();
```
