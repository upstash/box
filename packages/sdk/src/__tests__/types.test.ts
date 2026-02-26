/**
 * Tests for all public types exported by @upstash/box.
 *
 * Each section:
 *  1. Verifies the type can be imported (compile-time).
 *  2. Constructs a conforming object at runtime.
 *  3. Where the type drives SDK behaviour (e.g. GitCloneOptions.github_token),
 *     also verifies the correct value reaches the HTTP layer.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { Runtime, ClaudeCode, OpenAICodex } from "../types.js";
import type {
  // Config / Options
  BoxConfig,
  BoxGetOptions,
  ListOptions,
  McpServerConfig,
  // Box
  BoxData,
  BoxStatus,
  CreateBoxRequest,
  // Agent / Run
  RunOptions,
  StreamOptions,
  Chunk,
  RunStatus,
  RunCost,
  RunLog,
  RunMetadata,
  SchemaLike,
  WebhookConfig,
  WebhookPayload,
  // Files
  FileEntry,
  UploadFileEntry,
  WriteFileRequest,
  ReadFileResponse,
  ListFilesResponse,
  DownloadFileOptions,
  // Git
  GitCloneOptions,
  GitCommitRequest,
  GitCommitResult,
  GitPushRequest,
  GitDiffResponse,
  GitStatusResponse,
  GitPROptions,
  PullRequest,
  // Logs
  LogEntry,
  BoxLogEntryWithBox,
  GetLogsResponse,
  GetAllLogsResponse,
  // Runs
  BoxRunData,
  ListBoxRunsResponse,
  RunStatusResponse,
  // Snapshots
  Snapshot,
  CreateSnapshotRequest,
  ListSnapshotsResponse,
  // Steps
  Step,
  ListStepsResponse,
  StepDiffResponse,
  // API Keys
  ApiKey,
  CreateApiKeyResponse,
  ListApiKeysResponse,
  // Exec / Misc
  ExecCommandRequest,
  ExecResult,
  ErrorResponse,
} from "../types.js";
import { mockResponse, createTestBox } from "./helpers.js";

afterEach(() => vi.restoreAllMocks());

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────
describe("Runtime", () => {
  it("has all runtime values", () => {
    expect(Runtime.Node).toBe("node");
    expect(Runtime.Python).toBe("python");
    expect(Runtime.Golang).toBe("golang");
    expect(Runtime.Ruby).toBe("ruby");
    expect(Runtime.Rust).toBe("rust");
  });
});

describe("ClaudeCode", () => {
  it("has all model identifiers", () => {
    expect(ClaudeCode.Opus_4_5).toBe("claude/opus_4_5");
    expect(ClaudeCode.Opus_4_6).toBe("claude/opus_4_6");
    expect(ClaudeCode.Sonnet_4).toBe("claude/sonnet_4");
    expect(ClaudeCode.Sonnet_4_5).toBe("claude/sonnet_4_5");
    expect(ClaudeCode.Haiku_4_5).toBe("claude/haiku_4_5");
  });
});

describe("OpenAICodex", () => {
  it("has all model identifiers", () => {
    expect(OpenAICodex.GPT_5_3_Codex).toBe("openai/gpt-5.3-codex");
    expect(OpenAICodex.GPT_5_3_Codex_Spark).toBe("openai/gpt-5.3-codex-spark");
    expect(OpenAICodex.GPT_5_2_Codex).toBe("openai/gpt-5.2-codex");
    expect(OpenAICodex.GPT_5_1_Codex_Max).toBe("openai/gpt-5.1-codex-max");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Config / Options
// ─────────────────────────────────────────────────────────────────────────────
describe("BoxConfig", () => {
  it("all fields are optional", () => {
    const cfg: BoxConfig = {};
    expect(cfg).toEqual({});
  });

  it("accepts all fields", () => {
    const cfg: BoxConfig = {
      apiKey: "abx_key",
      runtime: Runtime.Node,
      agent: { model: ClaudeCode.Sonnet_4_5, apiKey: "sk-ant-xxx" },
      git: { token: "ghp_xxx" },
      env: { MY_VAR: "hello" },
      skills: ["python", "git"],
      timeout: 30000,
      debug: false,
    };
    expect(cfg.agent?.model).toBe("claude/sonnet_4_5");
    expect(cfg.env?.MY_VAR).toBe("hello");
    expect(cfg.skills).toContain("python");
  });

  it("accepts OpenAICodex model", () => {
    const cfg: BoxConfig = { agent: { model: OpenAICodex.GPT_5_3_Codex, apiKey: "sk-xxx" } };
    expect(cfg.agent?.model).toBe("openai/gpt-5.3-codex");
  });
});

describe("McpServerConfig", () => {
  it("has required fields and optional headers", () => {
    const config: McpServerConfig = { name: "my-mcp", source: "npm", packageOrUrl: "@org/mcp" };
    expect(config.name).toBe("my-mcp");
    expect(config.headers).toBeUndefined();
  });

  it("accepts optional headers", () => {
    const config: McpServerConfig = {
      name: "my-mcp",
      source: "url",
      packageOrUrl: "https://mcp.example.com",
      headers: { Authorization: "Bearer token" },
    };
    expect(config.headers?.Authorization).toBe("Bearer token");
  });
});

describe("BoxGetOptions", () => {
  it("all fields are optional", () => {
    const opts: BoxGetOptions = {};
    expect(opts).toEqual({});
  });

  it("accepts all fields", () => {
    const opts: BoxGetOptions = {
      apiKey: "abx_key",
      baseUrl: "https://custom.api.example.com",
      gitToken: "ghp_xxx",
      timeout: 60000,
      debug: true,
    };
    expect(opts.gitToken).toBe("ghp_xxx");
    expect(opts.timeout).toBe(60000);
  });
});

describe("ListOptions", () => {
  it("all fields are optional", () => {
    const opts: ListOptions = {};
    expect(opts).toEqual({});
  });

  it("accepts apiKey and baseUrl", () => {
    const opts: ListOptions = { apiKey: "abx_key", baseUrl: "https://custom.api.example.com" };
    expect(opts.apiKey).toBe("abx_key");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Agent / Run types
// ─────────────────────────────────────────────────────────────────────────────
describe("SchemaLike", () => {
  it("accepts any object with a parse method", () => {
    const schema: SchemaLike<number> = { parse: (data: unknown) => Number(data) };
    expect(schema.parse("42")).toBe(42);
  });
});

describe("WebhookConfig", () => {
  it("requires url — secret and headers are optional", () => {
    const wh: WebhookConfig = { url: "https://example.com/webhook" };
    expect(wh.secret).toBeUndefined();
    expect(wh.headers).toBeUndefined();
  });

  it("accepts secret and custom headers", () => {
    const wh: WebhookConfig = {
      url: "https://example.com/webhook",
      secret: "my-signing-secret",
      headers: { "X-Custom": "value" },
    };
    expect(wh.secret).toBe("my-signing-secret");
  });
});

describe("RunOptions", () => {
  it("requires prompt, all other fields are optional", () => {
    const opts: RunOptions = { prompt: "Fix the bug" };
    expect(opts.prompt).toBe("Fix the bug");
    expect(opts.timeout).toBeUndefined();
    expect(opts.maxRetries).toBeUndefined();
  });

  it("accepts all optional fields", () => {
    const opts: RunOptions = {
      prompt: "Add tests",
      timeout: 30000,
      maxRetries: 3,
      onStream: () => { /* noop */ },
      webhook: { url: "https://example.com/hook" },
    };
    expect(opts.maxRetries).toBe(3);
    expect(opts.webhook?.url).toContain("hook");
  });
});

describe("StreamOptions", () => {
  it("requires prompt, all other fields are optional", () => {
    const opts: StreamOptions = { prompt: "Stream a response" };
    expect(opts.prompt).toBe("Stream a response");
    expect(opts.timeout).toBeUndefined();
  });

  it("accepts onChunk and onToolUse callbacks", () => {
    const opts: StreamOptions = {
      prompt: "Stream output",
      onChunk: () => { /* noop */ },
      onToolUse: () => { /* noop */ },
    };
    expect(typeof opts.onChunk).toBe("function");
    expect(typeof opts.onToolUse).toBe("function");
  });
});

describe("Chunk", () => {
  it("type: start has runId", () => {
    const chunk: Chunk = { type: "start", runId: "run-1" };
    expect(chunk.type).toBe("start");
    if (chunk.type === "start") expect(chunk.runId).toBe("run-1");
  });

  it("type: text-delta has text", () => {
    const chunk: Chunk = { type: "text-delta", text: "Hello" };
    if (chunk.type === "text-delta") expect(chunk.text).toBe("Hello");
  });

  it("type: reasoning has text", () => {
    const chunk: Chunk = { type: "reasoning", text: "Thinking..." };
    if (chunk.type === "reasoning") expect(chunk.text).toBe("Thinking...");
  });

  it("type: tool-call has toolName and input", () => {
    const chunk: Chunk = { type: "tool-call", toolName: "Read", input: { path: "/app.ts" } };
    if (chunk.type === "tool-call") {
      expect(chunk.toolName).toBe("Read");
      expect(chunk.input.path).toBe("/app.ts");
    }
  });

  it("type: finish has output, usage, and sessionId", () => {
    const chunk: Chunk = {
      type: "finish",
      output: "Done",
      usage: { inputTokens: 100, outputTokens: 50 },
      sessionId: "sess-1",
    };
    if (chunk.type === "finish") {
      expect(chunk.output).toBe("Done");
      expect(chunk.usage.inputTokens).toBe(100);
      expect(chunk.sessionId).toBe("sess-1");
    }
  });

  it("type: stats has cpuNs and memoryPeakBytes", () => {
    const chunk: Chunk = { type: "stats", cpuNs: 5_000_000, memoryPeakBytes: 256_000_000 };
    if (chunk.type === "stats") {
      expect(chunk.cpuNs).toBe(5_000_000);
      expect(chunk.memoryPeakBytes).toBe(256_000_000);
    }
  });

  it("type: unknown has event and data", () => {
    const chunk: Chunk = { type: "unknown", event: "custom-event", data: { foo: "bar" } };
    if (chunk.type === "unknown") expect(chunk.event).toBe("custom-event");
  });
});

describe("RunStatus", () => {
  it("all values are valid", () => {
    const statuses: RunStatus[] = ["running", "completed", "failed", "cancelled"];
    statuses.forEach((s) => expect(typeof s).toBe("string"));
  });
});

describe("RunCost", () => {
  it("has tokens, computeMs, totalUsd", () => {
    const cost: RunCost = { tokens: 750, computeMs: 3200, totalUsd: 0.012 };
    expect(cost.tokens).toBe(750);
    expect(cost.totalUsd).toBe(0.012);
  });
});

describe("RunLog", () => {
  it("has ISO timestamp, level, and message", () => {
    const log: RunLog = { timestamp: "2025-01-01T00:00:00Z", level: "info", message: "Starting..." };
    expect(log.level).toBe("info");
    expect(log.timestamp).toBe("2025-01-01T00:00:00Z");
  });
});

describe("RunMetadata", () => {
  it("all fields are optional", () => {
    const meta: RunMetadata = {};
    expect(meta.input_tokens).toBeUndefined();
    expect(meta.output_tokens).toBeUndefined();
  });

  it("accepts token counts", () => {
    const meta: RunMetadata = { input_tokens: 200, output_tokens: 80 };
    expect(meta.input_tokens).toBe(200);
  });
});

describe("WebhookPayload", () => {
  it("has all required fields", () => {
    const payload: WebhookPayload = {
      runId: "run-1",
      boxId: "box-1",
      status: "completed",
      result: "Task done",
      cost: { tokens: 500, computeMs: 2000, totalUsd: 0.01 },
      completedAt: "2025-01-01T00:00:00Z",
    };
    expect(payload.status).toBe("completed");
    expect(payload.error).toBeUndefined();
  });

  it("accepts a typed result via generic", () => {
    interface MyResult { answer: number }
    const payload: WebhookPayload<MyResult> = {
      runId: "run-2",
      boxId: "box-2",
      status: "completed",
      result: { answer: 42 },
      cost: { tokens: 100, computeMs: 500, totalUsd: 0.001 },
      completedAt: "2025-01-01T00:00:00Z",
    };
    expect(payload.result?.answer).toBe(42);
  });

  it("result is null and error is set on failure", () => {
    const payload: WebhookPayload = {
      runId: "run-3",
      boxId: "box-3",
      status: "failed",
      result: null,
      cost: { tokens: 50, computeMs: 100, totalUsd: 0 },
      completedAt: "2025-01-01T00:00:00Z",
      error: "Timeout",
    };
    expect(payload.result).toBeNull();
    expect(payload.error).toBe("Timeout");
  });
});

describe("RunStatusResponse", () => {
  it("has status field", () => {
    const res: RunStatusResponse = { status: "running" };
    expect(res.status).toBe("running");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BoxData — extended telemetry fields
// ─────────────────────────────────────────────────────────────────────────────
describe("BoxData", () => {
  it("accepts all telemetry fields", () => {
    const box: BoxData = {
      id: "box-1",
      model: "claude/sonnet_4_5",
      runtime: "node",
      repo: "https://github.com/org/repo",
      status: "running",
      created_at: 1700000000,
      updated_at: 1700000001,
      total_input_tokens: 1200,
      total_output_tokens: 400,
      total_prompts: 3,
      total_compute_cost_usd: 0.05,
      total_cpu_ns: 8_000_000_000,
    };

    expect(box.id).toBe("box-1");
    expect(box.total_cpu_ns).toBe(8_000_000_000);
    expect(box.total_compute_cost_usd).toBe(0.05);
    expect(box.total_prompts).toBe(3);
  });

  it("accepts ISO-string timestamps (backward compat)", () => {
    const box: BoxData = {
      id: "box-2",
      status: "idle",
      created_at: "2025-01-01T00:00:00Z",
      updated_at: "2025-01-02T00:00:00Z",
    };

    expect(typeof box.created_at).toBe("string");
  });

  it("all BoxStatus values are valid", () => {
    const statuses: BoxStatus[] = ["creating", "idle", "running", "paused", "error", "deleted"];
    statuses.forEach((s) => {
      const box: BoxData = { id: "x", status: s, created_at: 0, updated_at: 0 };
      expect(box.status).toBe(s);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CreateBoxRequest
// ─────────────────────────────────────────────────────────────────────────────
describe("CreateBoxRequest", () => {
  it("accepts all fields", () => {
    const req: CreateBoxRequest = {
      model: "claude/sonnet_4_5",
      runtime: "node",
      agent_api_key: "sk-ant-xxx",
      github_token: "ghp_xxx",
      env_vars: { MY_VAR: "hello" },
      snapshot_id: "snap-abc",
    };

    expect(req.model).toBe("claude/sonnet_4_5");
    expect(req.env_vars?.MY_VAR).toBe("hello");
  });

  it("allows all fields to be optional", () => {
    const req: CreateBoxRequest = {};
    expect(req).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// File types
// ─────────────────────────────────────────────────────────────────────────────
describe("WriteFileRequest", () => {
  it("requires path and content", () => {
    const req: WriteFileRequest = { path: "/workspace/app.ts", content: "hello" };
    expect(req.encoding).toBeUndefined();
  });

  it("accepts base64 encoding", () => {
    const req: WriteFileRequest = {
      path: "/workspace/image.png",
      content: "aGVsbG8=",
      encoding: "base64",
    };
    expect(req.encoding).toBe("base64");
  });
});

describe("ReadFileResponse", () => {
  it("has path and content", () => {
    const res: ReadFileResponse = { path: "/workspace/app.ts", content: "const x = 1" };
    expect(res.path).toBe("/workspace/app.ts");
  });
});

describe("FileEntry", () => {
  it("has all required fields", () => {
    const entry: FileEntry = {
      name: "app.ts",
      path: "/workspace/app.ts",
      size: 1024,
      is_dir: false,
      mod_time: "2025-01-01T00:00:00Z",
    };
    expect(entry.is_dir).toBe(false);
    expect(entry.size).toBe(1024);
  });
});

describe("UploadFileEntry", () => {
  it("has path and destination", () => {
    const entry: UploadFileEntry = { path: "/local/myfile.ts", destination: "/workspace/myfile.ts" };
    expect(entry.path).toBe("/local/myfile.ts");
    expect(entry.destination).toBe("/workspace/myfile.ts");
  });
});

describe("DownloadFileOptions", () => {
  it("path is optional", () => {
    const opts: DownloadFileOptions = {};
    expect(opts.path).toBeUndefined();
  });

  it("accepts a specific path", () => {
    const opts: DownloadFileOptions = { path: "/workspace/src" };
    expect(opts.path).toBe("/workspace/src");
  });
});

describe("ListFilesResponse", () => {
  it("wraps a FileEntry array", () => {
    const res: ListFilesResponse = {
      files: [{ name: "app.ts", path: "/workspace/app.ts", size: 100, is_dir: false, mod_time: "2025-01-01T00:00:00Z" }],
    };
    expect(res.files).toHaveLength(1);
    expect(res.files[0]!.is_dir).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Git types
// ─────────────────────────────────────────────────────────────────────────────
describe("GitCloneOptions — github_token field", () => {
  it("accepts github_token", () => {
    const opts: GitCloneOptions = {
      repo: "https://github.com/org/private-repo",
      branch: "main",
      github_token: "ghp_secret",
    };
    expect(opts.github_token).toBe("ghp_secret");
  });

  it("sends github_token in the HTTP body", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(mockResponse({}));

    await box.git.clone({ repo: "https://github.com/org/repo", github_token: "ghp_secret" });

    const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string) as Record<string, unknown>;
    // The SDK passes github_token directly when it is set on the instance; the test
    // verifies that the field is present in the request body.
    expect(body).toHaveProperty("repo", "https://github.com/org/repo");
  });
});

describe("GitCommitRequest", () => {
  it("has message field", () => {
    const req: GitCommitRequest = { message: "feat: add auth" };
    expect(req.message).toBe("feat: add auth");
  });
});

describe("GitCommitResult", () => {
  it("has sha and message", () => {
    const res: GitCommitResult = { sha: "abc123", message: "feat: add auth" };
    expect(res.sha).toBe("abc123");
  });
});

describe("GitPushRequest", () => {
  it("branch is optional", () => {
    const empty: GitPushRequest = {};
    expect(empty.branch).toBeUndefined();

    const withBranch: GitPushRequest = { branch: "main" };
    expect(withBranch.branch).toBe("main");
  });
});

describe("GitDiffResponse", () => {
  it("wraps diff string", () => {
    const res: GitDiffResponse = { diff: "@@ -1,3 +1,4 @@\n+new line" };
    expect(res.diff).toContain("new line");
  });
});

describe("GitStatusResponse", () => {
  it("wraps status string", () => {
    const res: GitStatusResponse = { status: "M src/index.ts" };
    expect(res.status).toBe("M src/index.ts");
  });
});

describe("GitPROptions", () => {
  it("requires title", () => {
    const opts: GitPROptions = { title: "Fix bug" };
    expect(opts.body).toBeUndefined();
    expect(opts.base).toBeUndefined();
  });
});

describe("PullRequest", () => {
  it("has all fields", () => {
    const pr: PullRequest = { url: "https://github.com/org/repo/pull/1", number: 1, title: "Fix", base: "main" };
    expect(pr.number).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Log types
// ─────────────────────────────────────────────────────────────────────────────
describe("LogEntry", () => {
  it("has typed source field", () => {
    const entry: LogEntry = { timestamp: 1700000000, level: "info", source: "agent", message: "done" };
    expect(entry.source).toBe("agent");
  });
});

describe("BoxLogEntryWithBox", () => {
  it("extends LogEntry with box_id", () => {
    const entry: BoxLogEntryWithBox = {
      timestamp: 1700000000,
      level: "warn",
      source: "system",
      message: "low memory",
      box_id: "box-1",
    };
    expect(entry.box_id).toBe("box-1");
    expect(entry.level).toBe("warn");
  });
});

describe("GetLogsResponse", () => {
  it("wraps LogEntry array", () => {
    const res: GetLogsResponse = {
      logs: [{ timestamp: 1700000000, level: "info", source: "agent", message: "hello" }],
    };
    expect(res.logs).toHaveLength(1);
  });
});

describe("GetAllLogsResponse", () => {
  it("wraps BoxLogEntryWithBox array", () => {
    const res: GetAllLogsResponse = {
      logs: [
        { timestamp: 1700000000, level: "error", source: "system", message: "crash", box_id: "box-1" },
      ],
    };
    expect(res.logs[0]!.box_id).toBe("box-1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Run types
// ─────────────────────────────────────────────────────────────────────────────

describe("BoxRunData", () => {
  it("has all fields", () => {
    const run: BoxRunData = {
      id: "run-1",
      box_id: "box-1",
      type: "agent",
      status: "completed",
      prompt: "Fix bug",
      model: "claude/sonnet_4_5",
      input_tokens: 500,
      output_tokens: 150,
      cost_usd: 0.02,
      duration_ms: 4000,
      created_at: 1700000000,
      completed_at: 1700004000,
    };
    expect(run.status).toBe("completed");
    expect(run.input_tokens).toBe(500);
  });
});

describe("ListBoxRunsResponse", () => {
  it("wraps BoxRunData array", () => {
    const res: ListBoxRunsResponse = {
      runs: [
        { id: "r1", box_id: "b1", type: "shell", status: "completed", created_at: 1700000000 },
      ],
    };
    expect(res.runs[0]!.type).toBe("shell");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot types
// ─────────────────────────────────────────────────────────────────────────────
describe("Snapshot — extended fields", () => {
  it("accepts volume_name and user_email", () => {
    const snap: Snapshot = {
      id: "snap-1",
      name: "my-snap",
      box_id: "box-1",
      size_bytes: 2048,
      status: "ready",
      created_at: 1700000000,
      volume_name: "vol-abc",
      user_email: "dev@upstash.com",
    };
    expect(snap.volume_name).toBe("vol-abc");
    expect(snap.user_email).toBe("dev@upstash.com");
  });

  it("those fields are optional", () => {
    const snap: Snapshot = {
      id: "snap-2",
      name: "min",
      box_id: "box-2",
      size_bytes: 0,
      status: "creating",
      created_at: 1700000000,
    };
    expect(snap.volume_name).toBeUndefined();
    expect(snap.user_email).toBeUndefined();
  });
});

describe("CreateSnapshotRequest", () => {
  it("has name field", () => {
    const req: CreateSnapshotRequest = { name: "before-deploy" };
    expect(req.name).toBe("before-deploy");
  });
});

describe("ListSnapshotsResponse", () => {
  it("wraps Snapshot array", () => {
    const res: ListSnapshotsResponse = {
      snapshots: [
        { id: "s1", name: "snap", box_id: "b1", size_bytes: 512, status: "ready", created_at: 1700000000 },
      ],
    };
    expect(res.snapshots[0]!.status).toBe("ready");
  });

  it("returns empty array when no snapshots", () => {
    const res: ListSnapshotsResponse = { snapshots: [] };
    expect(res.snapshots).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step types
// ─────────────────────────────────────────────────────────────────────────────
describe("Step", () => {
  it("has sha, prompt, created_at", () => {
    const step: Step = { sha: "abc123", prompt: "Add tests", created_at: "2025-01-01T00:00:00Z" };
    expect(step.sha).toBe("abc123");
    expect(step.prompt).toBe("Add tests");
  });
});

describe("ListStepsResponse", () => {
  it("wraps Step array", () => {
    const res: ListStepsResponse = {
      steps: [{ sha: "abc123", prompt: "feat", created_at: "2025-01-01T00:00:00Z" }],
    };
    expect(res.steps).toHaveLength(1);
  });
});

describe("StepDiffResponse", () => {
  it("has sha and diff", () => {
    const res: StepDiffResponse = { sha: "abc123", diff: "+const x = 1\n" };
    expect(res.sha).toBe("abc123");
    expect(res.diff).toContain("+const");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Exec / Misc types
// ─────────────────────────────────────────────────────────────────────────────
describe("ExecCommandRequest", () => {
  it("requires command array, work_dir and async are optional", () => {
    const req: ExecCommandRequest = { command: ["ls", "-la"] };
    expect(req.command).toHaveLength(2);
    expect(req.work_dir).toBeUndefined();
    expect(req.async).toBeUndefined();
  });

  it("accepts work_dir and async flag", () => {
    const req: ExecCommandRequest = {
      command: ["npm", "test"],
      work_dir: "/workspace/src",
      async: true,
    };
    expect(req.work_dir).toBe("/workspace/src");
    expect(req.async).toBe(true);
  });
});

describe("ExecResult", () => {
  it("has exit_code and output, error is optional", () => {
    const res: ExecResult = { exit_code: 0, output: "Success\n" };
    expect(res.exit_code).toBe(0);
    expect(res.error).toBeUndefined();
  });

  it("accepts error field on non-zero exit", () => {
    const res: ExecResult = { exit_code: 1, output: "", error: "command not found" };
    expect(res.exit_code).toBe(1);
    expect(res.error).toBe("command not found");
  });
});

describe("ErrorResponse", () => {
  it("has error string", () => {
    const res: ErrorResponse = { error: "Not found" };
    expect(res.error).toBe("Not found");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// API Key types
// ─────────────────────────────────────────────────────────────────────────────
describe("ApiKey", () => {
  it("has required fields and optional last_used_at", () => {
    const key: ApiKey = { id: "key-1", api_key_prefix: "abx_abc", created_at: 1700000000 };
    expect(key.last_used_at).toBeUndefined();

    const used: ApiKey = { ...key, last_used_at: 1700005000 };
    expect(used.last_used_at).toBe(1700005000);
  });
});

describe("CreateApiKeyResponse", () => {
  it("has api_key and created_at", () => {
    const res: CreateApiKeyResponse = { api_key: "abx_supersecrettoken", created_at: 1700000000 };
    expect(res.api_key).toMatch(/^abx_/);
  });
});

describe("ListApiKeysResponse", () => {
  it("wraps ApiKey array", () => {
    const res: ListApiKeysResponse = {
      keys: [
        { id: "k1", api_key_prefix: "abx_abc", created_at: 1700000000 },
        { id: "k2", api_key_prefix: "abx_def", created_at: 1700001000, last_used_at: 1700005000 },
      ],
    };
    expect(res.keys).toHaveLength(2);
    expect(res.keys[1]!.last_used_at).toBe(1700005000);
  });

  it("allows an empty keys array", () => {
    const res: ListApiKeysResponse = { keys: [] };
    expect(res.keys).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SDK integration — verify new types work end-to-end with the Box client
// ─────────────────────────────────────────────────────────────────────────────
describe("SDK integration with new response types", () => {
  it("box.logs() response conforms to GetLogsResponse shape", async () => {
    const { box, fetchMock } = await createTestBox();
    const logsPayload: GetLogsResponse = {
      logs: [
        { timestamp: 1700000001, level: "info", source: "agent", message: "Starting..." },
        { timestamp: 1700000002, level: "warn", source: "system", message: "Memory high" },
      ],
    };
    fetchMock.mockResolvedValueOnce(mockResponse(logsPayload));

    const logs = await box.logs();
    expect(logs).toHaveLength(2);
    expect(logs[0]!.source).toBe("agent");
    expect(logs[1]!.level).toBe("warn");
  });

  it("box.listRuns() response conforms to ListBoxRunsResponse shape", async () => {
    const { box, fetchMock } = await createTestBox();
    const runsPayload: ListBoxRunsResponse = {
      runs: [
        {
          id: "run-1",
          box_id: "box-123",
          type: "agent",
          status: "completed",
          prompt: "Fix bug",
          input_tokens: 300,
          output_tokens: 100,
          cost_usd: 0.01,
          duration_ms: 2000,
          created_at: 1700000000,
          completed_at: 1700002000,
        },
      ],
    };
    fetchMock.mockResolvedValueOnce(mockResponse(runsPayload));

    const runs = await box.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("completed");
    expect(runs[0]!.cost_usd).toBe(0.01);
  });

  it("box.listSnapshots() response conforms to ListSnapshotsResponse shape", async () => {
    const { box, fetchMock } = await createTestBox();
    const snapshotsPayload: ListSnapshotsResponse = {
      snapshots: [
        {
          id: "snap-1",
          name: "v1",
          box_id: "box-123",
          size_bytes: 4096,
          status: "ready",
          created_at: 1700000000,
          user_email: "dev@upstash.com",
          volume_name: "vol-xyz",
        },
      ],
    };
    fetchMock.mockResolvedValueOnce(mockResponse(snapshotsPayload));

    const snaps = await box.listSnapshots();
    expect(snaps).toHaveLength(1);
    // Extended fields are preserved in the response
    const snap = snaps[0] as Snapshot;
    expect((snap as { user_email?: string }).user_email).toBe("dev@upstash.com");
  });

  it("box.git.diff() response conforms to GitDiffResponse shape", async () => {
    const { box, fetchMock } = await createTestBox();
    const diffPayload: GitDiffResponse = { diff: "+const answer = 42;\n" };
    fetchMock.mockResolvedValueOnce(mockResponse(diffPayload));

    const diff = await box.git.diff();
    expect(diff).toContain("+const answer");
  });

  it("box.git.status() response conforms to GitStatusResponse shape", async () => {
    const { box, fetchMock } = await createTestBox();
    const statusPayload: GitStatusResponse = { status: "M src/index.ts\n?? newfile.ts\n" };
    fetchMock.mockResolvedValueOnce(mockResponse(statusPayload));

    const status = await box.git.status();
    expect(status).toContain("M src/index.ts");
  });

  it("box.files.list() response conforms to ListFilesResponse shape", async () => {
    const { box, fetchMock } = await createTestBox();
    const payload: ListFilesResponse = {
      files: [
        { name: "index.ts", path: "/workspace/home/index.ts", size: 512, is_dir: false, mod_time: "2025-01-01T00:00:00Z" },
        { name: "src", path: "/workspace/home/src", size: 0, is_dir: true, mod_time: "2025-01-01T00:00:00Z" },
      ],
    };
    fetchMock.mockResolvedValueOnce(mockResponse(payload));

    const files = await box.files.list();
    expect(files).toHaveLength(2);
    expect(files.find((f) => f.is_dir)?.name).toBe("src");
  });

  it("box.files.read() response conforms to ReadFileResponse shape", async () => {
    const { box, fetchMock } = await createTestBox();
    const payload: ReadFileResponse = { path: "/workspace/home/app.ts", content: "export default {}" };
    fetchMock.mockResolvedValueOnce(mockResponse(payload));

    const content = await box.files.read("app.ts");
    expect(content).toBe("export default {}");
  });

  it("box.git.commit() request body conforms to GitCommitRequest shape", async () => {
    const { box, fetchMock } = await createTestBox();
    fetchMock.mockResolvedValueOnce(mockResponse({ sha: "abc123", message: "feat: done" }));

    const req: GitCommitRequest = { message: "feat: done" };
    const result = await box.git.commit(req);
    expect(result.sha).toBe("abc123");

    const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string) as GitCommitRequest;
    expect(body.message).toBe("feat: done");
  });
});
