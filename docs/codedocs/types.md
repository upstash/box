---
title: "Types"
description: "All exported TypeScript types, interfaces, and enums from the Box SDK."
---

Below are the full exported type definitions from `packages/sdk/src/types.ts`, grouped by theme. These are the public contract for the SDK and are safe to import in application code.

## Enums and basic unions
```ts
export type Runtime = "node" | "python" | "golang" | "ruby" | "rust";
export type BoxSize = "small" | "medium" | "large";

export enum Agent {
  ClaudeCode = "claude-code",
  Codex = "codex",
  OpenCode = "opencode",
}

export enum ClaudeCode {
  Opus_4_5 = "claude/opus_4_5",
  Opus_4_6 = "claude/opus_4_6",
  Sonnet_4 = "claude/sonnet_4",
  Sonnet_4_5 = "claude/sonnet_4_5",
  Sonnet_4_6 = "claude/sonnet_4_6",
  Haiku_4_5 = "claude/haiku_4_5",
}

export enum OpenAICodex {
  GPT_5_3_Codex = "openai/gpt-5.3-codex",
  GPT_5_2_Codex = "openai/gpt-5.2-codex",
  GPT_5_1_Codex_Max = "openai/gpt-5.1-codex-max",
  GPT_5_1_Codex_Mini = "openai/gpt-5.1-codex-mini",
}

export enum OpenRouterModel {
  Claude_Sonnet_4 = "openrouter/anthropic/claude-sonnet-4",
  Claude_Opus_4_5 = "openrouter/anthropic/claude-opus-4-5",
  Claude_Haiku_4_5 = "openrouter/anthropic/claude-haiku-4-5",
  DeepSeek_R1 = "openrouter/deepseek/deepseek-r1",
  Gemini_2_5_Pro = "openrouter/google/gemini-2.5-pro",
  Gemini_2_5_Flash = "openrouter/google/gemini-2.5-flash",
  GPT_4_1 = "openrouter/openai/gpt-4.1",
  O3 = "openrouter/openai/o3",
  O4_Mini = "openrouter/openai/o4-mini",
}

export enum OpenCodeModel {
  Claude_Opus_4_5 = "claude/opus_4_5",
  Claude_Opus_4_6 = "claude/opus_4_6",
  Claude_Sonnet_4 = "claude/sonnet_4",
  Claude_Sonnet_4_5 = "claude/sonnet_4_5",
  Claude_Sonnet_4_6 = "claude/sonnet_4_6",
  Claude_Haiku_4_5 = "claude/haiku_4_5",
  GPT_5_3_Codex = "openai/gpt-5.3-codex",
  GPT_5_2_Codex = "openai/gpt-5.2-codex",
  GPT_5_1_Codex_Max = "openai/gpt-5.1-codex-max",
  GPT_5_1_Codex_Mini = "openai/gpt-5.1-codex-mini",
  GPT_4_1 = "openai/gpt-4.1",
  O3 = "openai/o3",
  O4_Mini = "openai/o4-mini",
  Zen_GPT_5_Nano = "opencode/gpt-5-nano",
  Zen_MiniMax_M2_5_Free = "opencode/minimax-m2.5-free",
  Zen_Big_Pickle = "opencode/big-pickle",
  Zen_Claude_Sonnet_4_6 = "opencode/claude-sonnet-4-6",
  Zen_Claude_Sonnet_4_5 = "opencode/claude-sonnet-4-5",
  Zen_Claude_Sonnet_4 = "opencode/claude-sonnet-4",
  Zen_Claude_Haiku_4_5 = "opencode/claude-haiku-4-5",
  Zen_Claude_Opus_4_6 = "opencode/claude-opus-4-6",
  Zen_Claude_Opus_4_5 = "opencode/claude-opus-4-5",
  Zen_Claude_Opus_4_1 = "opencode/claude-opus-4-1",
  Zen_Gemini_3_1_Pro = "opencode/gemini-3.1-pro",
  Zen_Gemini_3_Pro = "opencode/gemini-3-pro",
  Zen_Gemini_3_Flash = "opencode/gemini-3-flash",
}

export enum BoxApiKey {
  UpstashKey = "UPSTASH_KEY",
  StoredKey = "STORED_KEY",
}
```

## Agent configuration
```ts
export type AgentConfig = {
  apiKey?: BoxApiKey | string;
} & (
  | { provider: Agent.ClaudeCode; model: ClaudeCode | OpenRouterModel; runner?: never }
  | { provider: Agent.Codex; model: OpenAICodex | OpenRouterModel; runner?: never }
  | {
      provider: Agent.OpenCode;
      model: OpenCodeModel | ClaudeCode | OpenAICodex | OpenRouterModel;
      runner?: never;
    }
  | { provider: string; model: string; runner?: never }
  | { runner: Agent; model: OpenCodeModel | ClaudeCode | OpenAICodex | OpenRouterModel; provider?: never }
  | { runner: string; model: string; provider?: never }
);

export interface ClaudeCodeAgentOptions {
  maxTurns?: number;
  maxBudgetUsd?: number;
  effort?: "low" | "medium" | "high" | "max";
  thinking?:
    | { type: "adaptive" }
    | { type: "enabled"; budgetTokens: number }
    | { type: "disabled" };
  disallowedTools?: string[];
  agents?: Record<string, unknown>;
  promptSuggestions?: boolean;
  fallbackModel?: string;
  systemPrompt?: string | Record<string, unknown>;
}

export interface CodexAgentOptions {
  modelReasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  modelReasoningSummary?: "auto" | "concise" | "detailed" | "none";
  personality?: "friendly" | "pragmatic" | "none";
  webSearch?: "live" | boolean;
}

export interface OpenCodeAgentOptions {
  reasoningEffort?: "low" | "medium" | "high";
  textVerbosity?: "low" | "medium" | "high";
  reasoningSummary?: "auto" | "concise" | "detailed" | "none";
  thinking?: { type: "enabled"; budgetTokens: number };
}

export type AgentOptions<TProvider = unknown> = TProvider extends Agent.ClaudeCode
  ? ClaudeCodeAgentOptions
  : TProvider extends Agent.Codex
    ? CodexAgentOptions
    : TProvider extends Agent.OpenCode
      ? OpenCodeAgentOptions
      : Record<string, unknown>;
```

## Network policy and MCP
```ts
export type NetworkPolicy =
  | { mode: "allow-all" | "deny-all" }
  | {
      mode: "custom";
      allowedDomains?: string[];
      allowedCidrs?: string[];
      deniedCidrs?: string[];
    };

export type McpServerConfig = {
  name: string;
} & (
  | { package: string; args?: string[]; url?: never; headers?: never }
  | { url: string; headers?: Record<string, string>; package?: never; args?: never }
);
```

## Box configuration
```ts
export interface BoxConnectionOptions {
  apiKey?: string;
  baseUrl?: string;
}

export interface ListOptions extends BoxConnectionOptions {}

export interface BoxGetOptions extends BoxConnectionOptions {
  gitToken?: string;
  timeout?: number;
  debug?: boolean;
}

export interface BoxConfig extends BoxConnectionOptions {
  name?: string;
  runtime?: Runtime;
  size?: BoxSize;
  agent?: AgentConfig;
  git?: { token?: string; userName?: string; userEmail?: string };
  env?: Record<string, string>;
  attachHeaders?: Record<string, Record<string, string>>;
  networkPolicy?: NetworkPolicy;
  skills?: string[];
  mcpServers?: McpServerConfig[];
  timeout?: number;
  debug?: boolean;
}

export interface EphemeralBoxConfig extends BoxConnectionOptions {
  name?: string;
  runtime?: Runtime;
  size?: BoxSize;
  ttl?: number;
  env?: Record<string, string>;
  attachHeaders?: Record<string, Record<string, string>>;
  networkPolicy?: NetworkPolicy;
  timeout?: number;
  debug?: boolean;
}

export interface EphemeralBoxData extends BoxData {
  ephemeral: boolean;
  expires_at: number;
}
```

## Runs and streaming
```ts
export interface WebhookConfig {
  url: string;
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
      usage: { inputTokens: number; outputTokens: number };
      sessionId: string;
    }
  | { type: "stats"; cpuNs: number; memoryPeakBytes: number }
  | { type: "unknown"; event: string; data: unknown };

export type PromptFiles = string[] | { data: string; mediaType: string; filename?: string }[];

export interface StreamOptions<TProvider = unknown> {
  prompt: string;
  files?: PromptFiles;
  options?: AgentOptions<TProvider>;
  timeout?: number;
  onToolUse?: (tool: { name: string; input: Record<string, unknown> }) => void;
}

export interface RunOptions<T = undefined, TProvider = unknown> {
  prompt: string;
  responseSchema?: ZodType<T>;
  files?: PromptFiles;
  options?: AgentOptions<TProvider>;
  timeout?: number;
  maxRetries?: number;
  onToolUse?: (tool: { name: string; input: Record<string, unknown> }) => void;
  webhook?: WebhookConfig;
}

export type RunStatus = "running" | "completed" | "failed" | "cancelled" | "detached";

export interface RunCost {
  inputTokens: number;
  outputTokens: number;
  computeMs: number;
  totalUsd: number;
}

export interface RunLog {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
}

export interface WebhookPayload {
  box_id: string;
  status: "completed" | "failed";
  run_id?: string;
  output?: string;
  metadata?: Record<string, unknown>;
  error?: string;
}
```

## Files and git
```ts
export interface UploadFileEntry {
  path: string;
  destination: string;
}

export interface FileEntry {
  name: string;
  path: string;
  size: number;
  is_dir: boolean;
  mod_time: string;
}

export interface GitCloneOptions { repo: string; branch?: string; }
export interface GitExecOptions { args: string[]; }
export interface GitExecResult { output: string; }
export interface GitCheckoutOptions { branch: string; }
export interface GitPROptions { title: string; body?: string; base?: string; }
export interface GitCommitOptions { message: string; authorName?: string; authorEmail?: string; }
export interface GitConfigUpdateOptions { userName?: string; userEmail?: string; }
export interface GitConfig { git_user_name: string; git_user_email: string; }
export interface GitCommitResult { sha: string; message: string; }
export interface PullRequest { url: string; number: number; title: string; base: string; }
```

## Code execution
```ts
export type CodeLanguage = "js" | "ts" | "python";

export interface CodeExecutionOptions {
  code: string;
  lang: CodeLanguage;
  timeout?: number;
}

export interface CodeExecutionResult {
  output: string;
  exit_code: number;
  error?: string;
}

export type ExecStreamChunk =
  | { type: "output"; data: string }
  | { type: "exit"; exitCode: number; cpuNs: number };
```

## Scheduling
```ts
export type ScheduleStatus = "active" | "paused" | "deleted";

export interface ExecScheduleOptions {
  cron: string;
  command: string[];
  folder?: string;
  webhookUrl?: string;
  webhookHeaders?: Record<string, string>;
}

export interface AgentScheduleOptions<TProvider = unknown> {
  cron: string;
  prompt: string;
  folder?: string;
  model?: string;
  options?: AgentOptions<TProvider>;
  timeout?: number;
  webhookUrl?: string;
  webhookHeaders?: Record<string, string>;
}

export interface Schedule {
  id: string;
  box_id: string;
  customer_id?: string;
  type: "exec" | "prompt";
  cron: string;
  command?: string[];
  prompt?: string;
  folder?: string;
  model?: string;
  agent_options?: Record<string, unknown>;
  timeout?: number;
  status: ScheduleStatus;
  qstash_schedule_id?: string;
  webhook_url?: string;
  webhook_headers?: Record<string, string>;
  last_run_at?: number;
  last_run_status?: "completed" | "failed" | "skipped";
  last_run_id?: string;
  total_runs: number;
  total_failures: number;
  created_at: number;
  updated_at: number;
}
```

## API response records
```ts
export type BoxStatus = "creating" | "idle" | "running" | "paused" | "error" | "deleted";

export type BoxData = {
  id: string;
  customer_id?: string;
  name?: string;
  size?: BoxSize;
  model?: string;
  agent?: Agent;
  enabled_skills?: string[];
  runtime?: string;
  status: BoxStatus;
  network_policy?: {
    mode: "allow-all" | "deny-all" | "custom";
    allowed_domains?: string[];
    allowed_cidrs?: string[];
    denied_cidrs?: string[];
  };
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

export interface RunResult { output: string; metadata?: RunMetadata; }
export interface RunMetadata { input_tokens?: number; output_tokens?: number; }
export interface ExecResult { exit_code: number; output: string; error?: string; }
export interface LogEntry { timestamp: number; level: "info" | "warn" | "error"; source: "system" | "agent" | "user"; message: string; }
export interface ErrorResponse { error: string; }

export type BoxRunData = {
  id: string;
  box_id: string;
  customer_id: string;
  type: "agent" | "shell";
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
} & (
  | { schedule_id?: never; status: "running" | "completed" | "failed" | "cancelled" }
  | { schedule_id: string; status: "completed" | "failed" | "skipped" }
);

export interface Snapshot {
  id: string;
  name: string;
  box_id: string;
  size_bytes: number;
  status: "creating" | "ready" | "error" | "deleted";
  created_at: number;
}

export interface Preview {
  url: string;
  port: number;
  token?: string;
  username?: string;
  password?: string;
}
```
