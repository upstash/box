# @upstash/box

TypeScript SDK for [Upstash Box](https://upstash.com/docs/box) — create sandboxed AI coding agents with streaming, structured output, file I/O, git operations, and snapshots.

## Installation

```bash
npm install @upstash/box
```

## Quick start

```ts
import { Box, Agent, ClaudeCode } from "@upstash/box";

const box = await Box.create({
  runtime: "node",
  agent: { provider: Agent.ClaudeCode, model: ClaudeCode.Sonnet_4_5 },
});

const run = await box.agent.run({
  prompt: "Create a hello world Express server",
});

console.log(run.result);
await box.delete();
```

## Authentication

Pass `apiKey` in the config or set the `UPSTASH_BOX_API_KEY` environment variable.

## API

### Static methods

#### `Box.create(config: BoxConfig): Promise<Box>`

Create a new sandboxed box.

```ts
import { Box, Agent, ClaudeCode, BoxApiKey } from "@upstash/box";

const box = await Box.create({
  apiKey: "abx_...", // or set UPSTASH_BOX_API_KEY
  runtime: "node", // "node" | "python" | "golang" | "ruby" | "rust"
  agent: {
    provider: Agent.ClaudeCode,
    model: ClaudeCode.Sonnet_4_5,
    apiKey: BoxApiKey.UpstashKey, // Upstash-managed key
    // apiKey: BoxApiKey.StoredKey,     // use a key stored via the Upstash console
    // apiKey: process.env.CLAUDE_KEY!, // or pass a direct API key
  },
  // Optional git identity configured in the container on create
  // Defaults: "Upstash Box" / "box@upstash.com"
  git: {
    token: process.env.GITHUB_TOKEN!,
    userName: "John Doe",
    userEmail: "john@example.com",
  },
  env: { NODE_ENV: "production" },
  timeout: 600000,
  debug: false,
});
```

#### `Box.get(boxId: string, options?: BoxGetOptions): Promise<Box>`

Reconnect to an existing box by ID.

```ts
const box = await Box.get("box_abc123");
```

#### `Box.getByName(name: string, options?: BoxGetOptions): Promise<Box>`

Get an existing box by name.

```ts
const box = await Box.getByName("my-box");
```

#### `Box.list(options?: ListOptions): Promise<BoxData[]>`

List all boxes for the authenticated user.

```ts
const boxes = await Box.list();
```

#### `Box.fromSnapshot(snapshotId: string, config: BoxConfig): Promise<Box>`

Create a new box from a saved snapshot.

```ts
const box = await Box.fromSnapshot("snap_abc123", {
  agent: { provider: Agent.ClaudeCode, model: ClaudeCode.Sonnet_4_5 },
});
```

### Agent

#### `box.agent.run(options: RunOptions): Promise<Run>`

Run the AI agent with a prompt. Supports streaming, structured output with Zod schemas, timeouts, retries, tool use callbacks, and webhooks.

```ts
// Structured output
import { z } from "zod";

const schema = z.object({
  name: z.string(),
  score: z.number(),
});

const run = await box.agent.run({
  prompt: "Analyze this candidate",
  responseSchema: schema,
});
const result = run.result; // typed as { name: string, score: number }

const stream = await box.agent.stream({
  prompt: "Refactor the auth flow",
});
for await (const part of stream) {
  if (part.type === "text-delta") process.stdout.write(part.text);
  if (part.type === "tool-call") console.log(part.toolName, part.input);
  if (part.type === "finish") console.log(part.usage.inputTokens + part.usage.outputTokens);
}
```

#### `box.exec.command(command: string): Promise<Run>`

Execute a shell command in the box.

```ts
const run = await box.exec.command("node index.js");
console.log(run.result);
```

### Files

```ts
await box.files.write({ path: "hello.txt", content: "Hello!" });
const content = await box.files.read("hello.txt");
const entries = await box.files.list(".");
await box.files.upload([{ path: "./local.txt", destination: "remote.txt" }]);
await box.files.download({ folder: "output/" });
```

### Git

```ts
await box.git.clone({ repo: "https://github.com/user/repo", branch: "main" });
const diff = await box.git.diff();
const status = await box.git.status();
await box.git.commit({
  message: "feat: add feature",
  authorName: "Jane Doe",
  authorEmail: "jane@example.com",
});

const gitConfig = await box.git.updateConfig({
  userName: "John Doe",
  userEmail: "john@example.com",
});
console.log(gitConfig.git_user_name, gitConfig.git_user_email);

await box.git.push({ branch: "main" });
const pr = await box.git.createPR({ title: "New feature", body: "Description" });

// Run an arbitrary git command
const result = await box.git.exec({ args: ["log", "--oneline", "-5"] });
console.log(result.output);

// Switch branches
await box.git.checkout({ branch: "feature-branch" });
```

### Schedules

Create recurring tasks that run on a cron schedule — either shell commands (`exec`) or AI agent prompts (`agent`). Schedules can be paused, resumed, and deleted. Available on both `Box` and `EphemeralBox`.

```ts
// Schedule a shell command to run every minute
const execSchedule = await box.schedule.exec({
  cron: "* * * * *",
  command: ["bash", "-c", "date >> /workspace/home/cron.log && echo scheduled-ok"],
});

// Schedule an agent prompt to run daily at 9am
const agentSchedule = await box.schedule.agent({
  cron: "0 9 * * *",
  prompt: "Run the test suite and fix any failures",
});

// List all active and paused schedules.
const schedules = await box.schedule.list();

// Get a specific schedule by ID.
const schedule = await box.schedule.get("sched-abc123");

// Pause a schedule. It won't fire until resumed.
await box.schedule.pause(schedule.id);

// Resume a paused schedule.
await box.schedule.resume(schedule.id);

// Delete a schedule permanently.
await box.schedule.delete(schedule.id);
```

### Working directory

```ts
box.cwd; // "/workspace/home" (default)

await box.cd("my-project");
box.cwd; // "/workspace/home/my-project"

// All operations now run relative to my-project/
const run = await box.exec.command("ls");
const files = await box.files.list();
const status = await box.git.status();

await box.cd(".."); // back to /workspace/home
```

### Model configuration

```ts
// Read the current provider and model
const { provider, model } = box.modelConfig;

// Change the model
await box.configureModel(ClaudeCode.Opus_4_5);

// modelConfig reflects the change immediately
box.modelConfig.model; // "claude/opus_4_5"
```

### Lifecycle

```ts
await box.pause(); // Pause (preserves state)
await box.resume(); // Resume
await box.delete(); // Permanent delete
const { status } = await box.getStatus();
```

### Snapshots

```ts
const snapshot = await box.snapshot({ name: "checkpoint-1" });
const snapshots = await box.listSnapshots();
await box.deleteSnapshot(snapshot.id);
```

### Run object

Every `agent.run()` and `exec.command()` call returns a `Run` object. Streaming methods (`agent.stream()`, `exec.stream()`) return a `StreamRun` which extends `Run` and is async-iterable.

```ts
const run = await box.agent.run({ prompt: "..." });

run.id; // Run ID
run.result; // Final output (typed if schema provided)
run.status; // "running" | "completed" | "failed" | "cancelled" | "detached"
run.cost; // { inputTokens, outputTokens, computeMs, totalUsd }
await run.cancel(); // Abort
await run.logs(); // Filtered log entries

// Streaming returns a StreamRun — async-iterable with typed Chunk objects
const stream = await box.agent.stream({ prompt: "..." });
for await (const chunk of stream) {
  if (chunk.type === "text-delta") process.stdout.write(chunk.text);
}
stream.status; // "completed" after iteration finishes
stream.result; // final output
```

## Agents

The `provider` field in agent config is optional — the SDK infers it from the model prefix. You can set it explicitly to use a specific provider.

| Enum               | Value         |
| ------------------ | ------------- |
| `Agent.ClaudeCode` | `claude-code` |
| `Agent.Codex`      | `codex`       |
| `Agent.OpenCode`   | `opencode`    |

## Models

### Claude Code

| Enum                    | Value               |
| ----------------------- | ------------------- |
| `ClaudeCode.Opus_4_5`   | `claude/opus_4_5`   |
| `ClaudeCode.Opus_4_6`   | `claude/opus_4_6`   |
| `ClaudeCode.Sonnet_4`   | `claude/sonnet_4`   |
| `ClaudeCode.Sonnet_4_5` | `claude/sonnet_4_5` |
| `ClaudeCode.Haiku_4_5`  | `claude/haiku_4_5`  |

### OpenAI Codex

| Enum                              | Value                        |
| --------------------------------- | ---------------------------- |
| `OpenAICodex.GPT_5_3_Codex`       | `openai/gpt-5.3-codex`       |
| `OpenAICodex.GPT_5_3_Codex_Spark` | `openai/gpt-5.3-codex-spark` |
| `OpenAICodex.GPT_5_2_Codex`       | `openai/gpt-5.2-codex`       |
| `OpenAICodex.GPT_5_1_Codex_Max`   | `openai/gpt-5.1-codex-max`   |

### OpenRouter

| Enum                               | Value                                   |
| ---------------------------------- | --------------------------------------- |
| `OpenRouterModel.Claude_Opus_4_5`  | `openrouter/anthropic/claude-opus-4-5`  |
| `OpenRouterModel.Claude_Sonnet_4`  | `openrouter/anthropic/claude-sonnet-4`  |
| `OpenRouterModel.Claude_Haiku_4_5` | `openrouter/anthropic/claude-haiku-4-5` |
| `OpenRouterModel.DeepSeek_R1`      | `openrouter/deepseek/deepseek-r1`       |
| `OpenRouterModel.Gemini_2_5_Pro`   | `openrouter/google/gemini-2.5-pro`      |
| `OpenRouterModel.Gemini_2_5_Flash` | `openrouter/google/gemini-2.5-flash`    |
| `OpenRouterModel.GPT_4_1`          | `openrouter/openai/gpt-4.1`             |
| `OpenRouterModel.O3`               | `openrouter/openai/o3`                  |
| `OpenRouterModel.O4_Mini`          | `openrouter/openai/o4-mini`             |

## Runtimes

`Runtime` is a string union type: `"node" | "python" | "golang" | "ruby" | "rust"`

## Examples

See the [`examples/`](./examples) directory for complete working examples:

- `basic.ts` — Create a box, run an agent, read output
- `streaming.ts` — Parallel boxes with structured output (Zod)
- `file-upload.ts` — Upload local files into the box
- `git-pr.ts` — Clone a repo, make changes, create a PR
- `snapshot-restore.ts` — Save and restore workspace state
- `webhook.ts` — Fire-and-forget with webhook callbacks
- `multi-runtime.ts` — Run across different runtimes
- `mcp-skills.ts` — Attach MCP servers to a box

## License

MIT
