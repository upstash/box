import type { ZodType } from "zod/v3";

/**
 * Runtime environments available for boxes
 */
export type Runtime = "node" | "python" | "golang" | "ruby" | "rust";

/**
 * Claude Code model identifiers
 */
export enum ClaudeCode {
  Opus_4_5 = "claude/opus_4_5",
  Opus_4_6 = "claude/opus_4_6",
  Sonnet_4 = "claude/sonnet_4",
  Sonnet_4_5 = "claude/sonnet_4_5",
  Haiku_4_5 = "claude/haiku_4_5",
}

/**
 * OpenAI Codex model identifiers
 */
export enum OpenAICodex {
  GPT_5_3_Codex = "openai/gpt-5.3-codex",
  GPT_5_3_Codex_Spark = "openai/gpt-5.3-codex-spark",
  GPT_5_2_Codex = "openai/gpt-5.2-codex",
  GPT_5_1_Codex_Max = "openai/gpt-5.1-codex-max",
}

export enum BoxApiKey {
  /**
   * Use an LLM API key provided by Upstash
   */
  UpstashKey = "UPSTASH_KEY",
  /**
   * Use an LLM API key previously stored via the UI or API
   */
  StoredKey = "STORED_KEY",
}

export interface BoxConfig {
  apiKey?: string;
  runtime?: Runtime;
  agent?: {
    model: ClaudeCode | OpenAICodex | string;
    /**
     * API key for the agent model.
     *
     * Options:
     * - BoxApiKey.UpstashKey: Use an LLM API key provided by Upstash
     * - BoxApiKey.StoredKey: Use an LLM API key previously stored via the UI or API
     * - Direct API key string (e.g. OpenAI key)
     *
     * When omitted, the server decides which key to use.
     */
    apiKey?: BoxApiKey | string;
  };
  git?: {
    token?: string;
  };
  env?: Record<string, string>;
  /**
   * GitHub repositories to install as skills on the box.
   *
   * Each entry is an `owner/repo` path (e.g. `"upstash/qstash-js"`).
   *
   * @example
   * ```ts
   * { skills: ["upstash/workflow-js", "upstash/qstash-js"] }
   * ```
   */
  skills?: string[];
  mcpServers?: McpServerConfig[];
  baseUrl?: string;
  timeout?: number;
  debug?: boolean;
}

/**
 * MCP server configuration — either a local package or a remote URL.
 *
 * @example Package-based server
 * ```ts
 * { name: "filesystem", package: "@modelcontextprotocol/server-filesystem" }
 * ```
 *
 * @example Remote server
 * ```ts
 * { name: "custom", url: "https://mcp.example.com/sse" }
 * ```
 */
export type McpServerConfig = {
  /** Display name used to identify this server */
  name: string;
} & (
  | {
      /** npm package specifier to run locally (e.g. "@org/mcp-server") */
      package: string;
      args?: string[];
      url?: never;
      headers?: never;
    }
  | {
      /** Remote MCP server endpoint */
      url: string;
      /** Custom headers sent with requests to the remote server */
      headers?: Record<string, string>;
      package?: never;
      args?: never;
    }
);

// ==================== Run ====================

/**
 * Webhook configuration for fire-and-forget runs
 */
export interface WebhookConfig {
  /** Endpoint to receive the POST on completion */
  url: string;
  /** HMAC-SHA256 signing key (sent as X-Box-Signature header) */
  secret?: string;
  /** Custom headers sent with the webhook POST */
  headers?: Record<string, string>;
}

export type Chunk =
  | { type: "start"; runId: string }
  | { type: "text-delta"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool-call"; toolName: string; input: Record<string, unknown> }
  | {
      type: "finish";
      output: string;
      usage: {
        inputTokens: number;
        outputTokens: number;
      };
      sessionId: string;
    }
  | { type: "stats"; cpuNs: number; memoryPeakBytes: number }
  | { type: "unknown"; event: string; data: unknown };

/**
 * Options for streaming agent output
 */
export interface StreamOptions {
  /** The prompt/task for the AI agent */
  prompt: string;
  /** Timeout in milliseconds — aborts if exceeded */
  timeout?: number;
  /** Inline streaming callback — called with each text chunk */
  onChunk?: (part: Chunk) => void;
  /** Tool use callback — called when the agent invokes a tool (Read, Write, Bash, etc.) */
  onToolUse?: (tool: { name: string; input: Record<string, unknown> }) => void;
}

/**
 * Options for running a prompt
 */
export interface RunOptions<T = undefined> {
  /** The prompt/task for the AI agent */
  prompt: string;
  /** Zod schema for structured output — typed, validated results */
  responseSchema?: ZodType<T>;
  /** Timeout in milliseconds — aborts if exceeded */
  timeout?: number;
  /** Retries with exponential backoff on transient failures */
  maxRetries?: number;
  /** Tool use callback — called when the agent invokes a tool (Read, Write, Bash, etc.) */
  onToolUse?: (tool: { name: string; input: Record<string, unknown> }) => void;
  /** Webhook — fire-and-forget, POST to URL on completion */
  webhook?: WebhookConfig;
}

export type BoxStatus = "creating" | "idle" | "running" | "paused" | "error" | "deleted";

export type RunStatus = "running" | "completed" | "failed" | "cancelled";

export interface RunCost {
  /** Input tokens consumed */
  inputTokens: number;
  /** Output tokens consumed */
  outputTokens: number;
  /** Wall-clock execution time in milliseconds */
  computeMs: number;
  /** Total cost in USD */
  totalUsd: number;
}

export interface RunLog {
  /** ISO 8601 timestamp */
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
}

/**
 * POST body sent to your webhook URL on run completion
 */
export interface WebhookPayload<T = string> {
  runId: string;
  boxId: string;
  status: RunStatus;
  result: T | null;
  cost: RunCost;
  completedAt: string;
  /** Error message when status is "failed" */
  error?: string;
}

/**
 * Pull request created via box.git.createPR()
 */
export interface PullRequest {
  url: string;
  number: number;
  title: string;
  base: string;
}

/**
 * Entry for uploading a local file to the box
 */
export interface UploadFileEntry {
  /** Local file path */
  path: string;
  /** Destination path inside the box container */
  destination: string;
}

/**
 * Snapshot of a box's workspace state
 */
export interface Snapshot {
  id: string;
  name: string;
  box_id: string;
  size_bytes: number;
  image_url?: string;
  s3_key?: string;
  status: "creating" | "ready" | "error" | "deleted";
  created_at: number;
}

/**
 * Options for listing boxes
 */
export interface ListOptions {
  /** Upstash Box API key. Falls back to UPSTASH_BOX_API_KEY env var. */
  apiKey?: string;
  /** Base URL of the Box API (defaults to https://box.api.upstashdev.com) */
  baseUrl?: string;
}

/**
 * Options for getting/reconnecting to an existing box
 */
export interface BoxGetOptions {
  /** Upstash Box API key. Falls back to UPSTASH_BOX_API_KEY env var. */
  apiKey?: string;
  /** Base URL of the Box API (defaults to https://box.api.upstashdev.com) */
  baseUrl?: string;
  /** GitHub personal access token */
  gitToken?: string;
  /** Request timeout in milliseconds (defaults to 600000) */
  timeout?: number;
  /** Enable debug logging */
  debug?: boolean;
}

// ==================== Code Execution ====================

/**
 * Supported languages for inline code execution
 */
export type CodeLanguage = "js" | "ts" | "python";

/**
 * Options for executing inline code in a box
 */
export interface CodeExecutionOptions {
  /** The source code to execute */
  code: string;
  /** Language of the code snippet */
  lang: CodeLanguage;
  /** Execution timeout in milliseconds */
  timeout?: number;
}

/**
 * Result of an inline code execution
 */
export interface CodeExecutionResult {
  /** stdout produced by the code */
  output: string;
  /** Process exit code (0 = success) */
  exit_code: number;
  /** stderr / error output, if any */
  error?: string;
}

// ==================== Exec Streaming ====================

export type ExecStreamChunk =
  | { type: "output"; data: string }
  | { type: "exit"; exitCode: number; cpuNs: number };

// ==================== Internal API Types ====================

export type BoxData = {
  id: string;
  customer_id?: string;
  name?: string;
  model?: string;
  runtime?: string;
  status: BoxStatus;
  clone_repo?: string;
  total_input_tokens?: number;
  total_output_tokens?: number;
  total_prompts?: number;
  session_id?: string;
  agent_id?: string;
  total_cpu_ns?: number;
  total_compute_cost_usd?: number;
  total_token_cost_usd?: number;
  use_managed_key?: boolean;
  last_activity_at?: number;
  created_at: number;
  updated_at: number;
};

export interface RunResult {
  output: string;
  metadata?: RunMetadata;
}

export interface RunMetadata {
  input_tokens?: number;
  output_tokens?: number;
}

export interface ExecResult {
  exit_code: number;
  output: string;
  error?: string;
}

export interface FileEntry {
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
  mod_time: string;
}

export interface GitCloneOptions {
  repo: string;
  branch?: string;
}

export interface GitExecOptions {
  args: string[];
}

export interface GitExecResult {
  output: string;
}

export interface GitCheckoutOptions {
  branch: string;
}

export interface GitPROptions {
  title: string;
  body?: string;
  base?: string;
}

export interface GitCommitResult {
  sha: string;
  message: string;
}

export interface LogEntry {
  timestamp: number;
  level: "info" | "warn" | "error";
  source: "system" | "agent" | "user";
  message: string;
}

export interface ErrorResponse {
  error: string;
}

/**
 * Backend run record — returned by Box.listRuns()
 */
export interface BoxRunData {
  id: string;
  box_id: string;
  customer_id: string;
  type: "agent" | "shell";
  status: "running" | "completed" | "failed" | "cancelled";
  prompt?: string;
  model?: string;
  output?: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  duration_ms: number;
  cpu_ns?: number;
  compute_cost_usd?: number;
  memory_peak_bytes?: number;
  error_message?: string;
  session_id?: string;
  created_at: number;
  completed_at?: number;
}
