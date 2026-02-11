/**
 * Runtime environments available for boxes
 */
export enum Runtime {
  Node = "node",
  Python = "python",
}

/**
 * Claude Code model identifiers
 */
export enum ClaudeCode {
  Opus_4_5 = "claude/opus_4_5",
  Opus_4_6 = "claude/opus_4_6",
  Sonnet_4 = "claude/sonnet_4",
  Sonnet_4_5 = "claude/sonnet_4_5",
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
    model: ClaudeCode | string;
    /** Claude/Anthropic API key for the AI agent */
    apiKey: string;
  };
  /** Git configuration (optional) */
  git?: {
    /** GitHub personal access token */
    token: string;
  };
  /** Base URL of the Box API (defaults to https://api.upstash.com) */
  baseUrl?: string;
  /** Request timeout in milliseconds (defaults to 600000) */
  timeout?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Options for running a prompt
 */
export interface RunOptions {
  /** The prompt/task for the AI agent */
  prompt: string;
  /** Zod schema for structured output (used with run.result()) */
  responseSchema?: unknown;
}

/**
 * Cost breakdown for a run
 */
export interface CostBreakdown {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalUsd: number;
}

/**
 * Entry for uploading a local file to the box
 */
export interface UploadFileEntry {
  /** Local file path */
  path: string;
  /** Path inside the box container */
  mountPath: string;
}

/**
 * Options for downloading files from the box
 */
export interface DownloadOptions {
  /** Remote path inside the box container */
  path: string;
  /** Local destination directory (defaults to ./basename) */
  dest?: string;
}

// ==================== Internal API Types ====================

export interface BoxData {
  id: string;
  repo?: string;
  branch: string;
  model: string;
  runtime?: string;
  status: string;
  pull_request_url?: string;
  created_at: string;
  updated_at: string;
}

export interface RunResult {
  output: string;
  files?: FileChange[];
  commit?: CommitInfo;
  pull_request?: string;
  metadata?: RunMetadata;
}

export interface FileChange {
  path: string;
  action: "created" | "modified" | "deleted";
}

export interface CommitInfo {
  sha: string;
  message: string;
}

export interface RunMetadata {
  inputTokens?: number;
  outputTokens?: number;
  executionTime?: number;
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
