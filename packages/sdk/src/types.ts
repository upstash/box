/**
 * Runtime environments available for boxes
 */
export enum Runtime {
  Node = "node",
  Python = "python",
  Golang = "golang",
  Ruby = "ruby",
  Rust = "rust",
}

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

/**
 * Configuration for creating a new box
 */
export interface BoxConfig {
  /** Upstash Box API key for platform authentication (abx_...). Falls back to UPSTASH_BOX_API_KEY env var. */
  apiKey?: string;
  /** Runtime environment */
  runtime?: Runtime | string;
  /** Agent configuration */
  agent: {
    /** Model to use */
    model: ClaudeCode | OpenAICodex | string;
    /** API key for the AI agent (Anthropic key for Claude, OpenAI key for Codex) */
    apiKey: string;
  };
  /** Git configuration (optional) */
  git?: {
    /** GitHub personal access token */
    token: string;
  };
  /** Environment variables injected into the box container */
  env?: Record<string, string>;
  /** Context7 skill identifiers (e.g. ["anthropics/skills/frontend-design"]) */
  skills?: string[];
  /** MCP server configurations */
  mcpServers?: McpServerConfig[];
  /** Base URL of the Box API (defaults to https://box.api.upstashdev.com) */
  baseUrl?: string;
  /** Request timeout in milliseconds (defaults to 600000) */
  timeout?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * MCP server configuration
 */
export interface McpServerConfig {
  /** Server name */
  name: string;
  /** Source type: "npm" or "url" */
  source: string;
  /** NPM package name or SSE URL */
  packageOrUrl: string;
  /** Auth headers (for SSE) or env vars (for npm/stdio) */
  headers?: Record<string, string>;
}

// ==================== Run ====================

/**
 * Any object with a .parse() method (compatible with Zod schemas).
 */
export interface SchemaLike<T> {
  parse(data: unknown): T;
}

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

/**
 * Options for running a prompt
 */
export interface RunOptions<T = undefined> {
  /** The prompt/task for the AI agent */
  prompt: string;
  /** Zod schema for structured output — typed, validated results */
  responseSchema?: SchemaLike<T>;
  /** Timeout in milliseconds — aborts if exceeded */
  timeout?: number;
  /** Retries with exponential backoff on transient failures */
  maxRetries?: number;
  /** Inline streaming callback — called with each text chunk */
  onStream?: (chunk: string) => void;
  /** Tool use callback — called when the agent invokes a tool (Read, Write, Bash, etc.) */
  onToolUse?: (tool: { name: string; input: Record<string, unknown> }) => void;
  /** Webhook — fire-and-forget, POST to URL on completion */
  webhook?: WebhookConfig;
}

export type RunStatus = "running" | "completed" | "failed" | "cancelled";

export interface RunCost {
  /** Total tokens consumed (input + output) */
  tokens: number;
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

// ==================== Internal API Types ====================

export interface BoxData {
  id: string;
  model: string;
  runtime?: string;
  status: string;
  created_at: string;
  updated_at: string;
}

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
  type: "agent" | "shell";
  status: RunStatus;
  prompt?: string;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  duration_ms?: number;
  error_message?: string;
  created_at: number;
  completed_at?: number;
}
