import type { ZodType } from "zod/v3";

/**
 * Runtime environments available for boxes.
 *
 * Defaults use Debian (glibc, wider binary compatibility). Append `-alpine`
 * for the smaller musl-based image of the same runtime.
 */
export type Runtime =
  | "node"
  | "python"
  | "golang"
  | "ruby"
  | "rust"
  | "node-alpine"
  | "python-alpine"
  | "golang-alpine"
  | "ruby-alpine"
  | "rust-alpine";

/**
 * Resource size presets for boxes.
 *
 * | Size     | CPU      | Memory |
 * |----------|----------|--------|
 * | `small`  | 2 cores  | 4 GB   |
 * | `medium` | 4 cores  | 8 GB   |
 * | `large`  | 8 cores  | 16 GB  |
 */
export type BoxSize = "small" | "medium" | "large";

/**
 * Agent SDKs available for boxes
 */
export enum Agent {
  ClaudeCode = "claude-code",
  Codex = "codex",
  OpenCode = "opencode",
  Cursor = "cursor",
  Custom = "custom",
}

/**
 * Claude Code model identifiers
 */
export enum ClaudeCode {
  Fable_5 = "anthropic/claude-fable-5",
  Opus_4_5 = "anthropic/claude-opus-4-5",
  Opus_4_6 = "anthropic/claude-opus-4-6",
  Opus_4_7 = "anthropic/claude-opus-4-7",
  Opus_4_8 = "anthropic/claude-opus-4-8",
  Opus_5 = "anthropic/claude-opus-5",
  Sonnet_4 = "anthropic/claude-sonnet-4",
  Sonnet_4_5 = "anthropic/claude-sonnet-4-5",
  Sonnet_4_6 = "anthropic/claude-sonnet-4-6",
  Sonnet_5 = "anthropic/claude-sonnet-5",
  Haiku_4_5 = "anthropic/claude-haiku-4-5",
}

/**
 * OpenAI Codex model identifiers
 */
export enum OpenAICodex {
  GPT_5_6 = "openai/gpt-5.6",
  GPT_5_6_Sol = "openai/gpt-5.6-sol",
  GPT_5_6_Terra = "openai/gpt-5.6-terra",
  GPT_5_6_Luna = "openai/gpt-5.6-luna",
  GPT_5_5 = "openai/gpt-5.5",
  GPT_5_4 = "openai/gpt-5.4",
  GPT_5_4_Mini = "openai/gpt-5.4-mini",
  GPT_5_3_Codex = "openai/gpt-5.3-codex",
  GPT_5_3_Codex_Spark = "openai/gpt-5.3-codex-spark",
  GPT_5_2_Codex = "openai/gpt-5.2-codex",
  GPT_5_1_Codex_Max = "openai/gpt-5.1-codex-max",
  GPT_5_1_Codex_Mini = "openai/gpt-5.1-codex-mini",
}

/**
 * OpenRouter model identifiers — shared across agents that support OpenRouter
 */
export enum OpenRouterModel {
  Claude_Fable_5 = "openrouter/anthropic/claude-fable-5",
  Claude_Opus_5 = "openrouter/anthropic/claude-opus-5",
  Claude_Sonnet_5 = "openrouter/anthropic/claude-sonnet-5",
  Claude_Sonnet_4 = "openrouter/anthropic/claude-sonnet-4",
  Claude_Opus_4_5 = "openrouter/anthropic/claude-opus-4-5",
  Claude_Haiku_4_5 = "openrouter/anthropic/claude-haiku-4-5",
  DeepSeek_R1 = "openrouter/deepseek/deepseek-r1",
  Gemini_2_5_Pro = "openrouter/google/gemini-2.5-pro",
  Gemini_2_5_Flash = "openrouter/google/gemini-2.5-flash",
  GPT_5_6_Sol = "openrouter/openai/gpt-5.6-sol",
  GPT_5_6_Terra = "openrouter/openai/gpt-5.6-terra",
  GPT_5_6_Luna = "openrouter/openai/gpt-5.6-luna",
  GPT_4_1 = "openrouter/openai/gpt-4.1",
  O3 = "openrouter/openai/o3",
  O4_Mini = "openrouter/openai/o4-mini",
}

/**
 * Vercel AI Gateway model identifiers — shared across agents that support Vercel AI Gateway
 */
export enum VercelModel {
  Claude_Fable_5 = "vercel/anthropic/claude-fable-5",
  Claude_Opus_5 = "vercel/anthropic/claude-opus-5",
  Claude_Sonnet_5 = "vercel/anthropic/claude-sonnet-5",
  Claude_Opus_4_7 = "vercel/anthropic/claude-opus-4.7",
  Claude_Sonnet_4_6 = "vercel/anthropic/claude-sonnet-4.6",
  Claude_Opus_4_6 = "vercel/anthropic/claude-opus-4.6",
  Claude_Haiku_4_5 = "vercel/anthropic/claude-haiku-4.5",
  GPT_5_6_Sol = "vercel/openai/gpt-5.6-sol",
  GPT_5_6_Terra = "vercel/openai/gpt-5.6-terra",
  GPT_5_6_Luna = "vercel/openai/gpt-5.6-luna",
  GPT_5_5 = "vercel/openai/gpt-5.5",
  GPT_5_5_Pro = "vercel/openai/gpt-5.5-pro",
  GPT_5_4 = "vercel/openai/gpt-5.4",
  GPT_5_4_Mini = "vercel/openai/gpt-5.4-mini",
  Gemini_3_5_Flash = "vercel/google/gemini-3.5-flash",
  Gemini_3_1_Flash_Lite = "vercel/google/gemini-3.1-flash-lite",
  Gemini_3_1_Pro_Preview = "vercel/google/gemini-3.1-pro-preview",
  Grok_Build_0_1 = "vercel/xai/grok-build-0.1",
  Grok_4_3 = "vercel/xai/grok-4.3",
  Grok_4_20_Reasoning = "vercel/xai/grok-4.20-reasoning",
}

/**
 * OpenCode model identifiers — supports models from multiple providers
 */
export enum OpenCodeModel {
  // Anthropic-backed OpenCode models
  Claude_Fable_5 = "opencode/claude-fable-5",
  Claude_Opus_5 = "opencode/claude-opus-5",
  Claude_Opus_4_5 = "opencode/claude-opus-4-5",
  Claude_Opus_4_6 = "opencode/claude-opus-4-6",
  Claude_Opus_4_7 = "opencode/claude-opus-4-7",
  Claude_Opus_4_8 = "opencode/claude-opus-4-8",
  Claude_Sonnet_4 = "opencode/claude-sonnet-4",
  Claude_Sonnet_4_5 = "opencode/claude-sonnet-4-5",
  Claude_Sonnet_4_6 = "opencode/claude-sonnet-4-6",
  Claude_Sonnet_5 = "opencode/claude-sonnet-5",
  Claude_Haiku_4_5 = "opencode/claude-haiku-4-5",
  // OpenAI-backed OpenCode models
  GPT_5_5 = "opencode/gpt-5.5",
  GPT_5_4 = "opencode/gpt-5.4",
  GPT_5_4_Pro = "opencode/gpt-5.4-pro",
  GPT_5_4_Mini = "opencode/gpt-5.4-mini",
  GPT_5_4_Nano = "opencode/gpt-5.4-nano",
  GPT_5_3_Codex = "opencode/gpt-5.3-codex",
  GPT_5_3_Codex_Spark = "opencode/gpt-5.3-codex-spark",
  GPT_5_2_Codex = "opencode/gpt-5.2-codex",
  GPT_5_1_Codex_Max = "opencode/gpt-5.1-codex-max",
  GPT_5_1_Codex_Mini = "opencode/gpt-5.1-codex-mini",
  GPT_4_1 = "opencode/gpt-4.1",
  O3 = "opencode/o3",
  O4_Mini = "opencode/o4-mini",
  // Free models
  Zen_GPT_5_Nano = "opencode/gpt-5-nano",
  Zen_Big_Pickle = "opencode/big-pickle",
  // Paid models
  Zen_MiniMax_M2_7 = "opencode/minimax-m2.7",
  Zen_Claude_Fable_5 = "opencode/claude-fable-5",
  Zen_Claude_Opus_5 = "opencode/claude-opus-5",
  Zen_Claude_Sonnet_4_6 = "opencode/claude-sonnet-4-6",
  Zen_Claude_Sonnet_4_5 = "opencode/claude-sonnet-4-5",
  Zen_Claude_Sonnet_4 = "opencode/claude-sonnet-4",
  Zen_Claude_Sonnet_5 = "opencode/claude-sonnet-5",
  Zen_Claude_Haiku_4_5 = "opencode/claude-haiku-4-5",
  Zen_Claude_Opus_4_8 = "opencode/claude-opus-4-8",
  Zen_Claude_Opus_4_7 = "opencode/claude-opus-4-7",
  Zen_Claude_Opus_4_6 = "opencode/claude-opus-4-6",
  Zen_Claude_Opus_4_5 = "opencode/claude-opus-4-5",
  Zen_Claude_Opus_4_1 = "opencode/claude-opus-4-1",
  Zen_Gemini_3_1_Pro = "opencode/gemini-3.1-pro",
  Zen_Gemini_3_Pro = "opencode/gemini-3-pro",
  Zen_Gemini_3_Flash = "opencode/gemini-3-flash",
}

/**
 * Cursor model identifiers
 */
export enum CursorModel {
  Default = "cursor/default",
  Composer_2_5 = "cursor/composer-2.5",
  GPT_5_5 = "cursor/gpt-5.5",
  GPT_5_4 = "cursor/gpt-5.4",
  GPT_5_4_Mini = "cursor/gpt-5.4-mini",
  GPT_5_4_Nano = "cursor/gpt-5.4-nano",
  GPT_5_3_Codex = "cursor/gpt-5.3-codex",
  GPT_5_3_Codex_Spark = "cursor/gpt-5.3-codex-spark",
  GPT_5_2 = "cursor/gpt-5.2",
  GPT_5_2_Codex = "cursor/gpt-5.2-codex",
  GPT_5_1 = "cursor/gpt-5.1",
  GPT_5_1_Codex_Max = "cursor/gpt-5.1-codex-max",
  GPT_5_1_Codex_Mini = "cursor/gpt-5.1-codex-mini",
  GPT_5_Mini = "cursor/gpt-5-mini",
  Claude_Fable_5 = "cursor/claude-fable-5",
  Claude_Opus_5 = "cursor/claude-opus-5",
  Claude_Opus_4_8 = "cursor/claude-opus-4-8",
  Claude_Opus_4_7 = "cursor/claude-opus-4-7",
  Claude_Opus_4_6 = "cursor/claude-opus-4-6",
  Claude_Opus_4_5 = "cursor/claude-opus-4-5",
  Claude_Sonnet_4_6 = "cursor/claude-sonnet-4-6",
  Claude_Sonnet_4_5 = "cursor/claude-sonnet-4-5",
  Claude_Sonnet_4 = "cursor/claude-sonnet-4",
  Claude_Sonnet_5 = "cursor/claude-sonnet-5",
  Claude_Haiku_4_5 = "cursor/claude-haiku-4-5",
  Gemini_3_1_Pro = "cursor/gemini-3.1-pro",
  Gemini_3_Flash = "cursor/gemini-3-flash",
  Gemini_2_5_Flash = "cursor/gemini-2.5-flash",
  Grok_4_20 = "cursor/grok-4-20",
  Kimi_K2_5 = "cursor/kimi-k2.5",
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

/**
 * Custom harness process contract.
 *
 * The command is executed inside the box container for each `box.agent.run()` or
 * `box.agent.stream()` call. The SDK/backend append `-p <prompt> --model <model> --stream`
 * and, when available, `--session <sessionId>`. The process must write
 * `box-sse-v1` events to stdout.
 */
export interface CustomHarnessConfig {
  /** Executable name from PATH, or an absolute path under /workspace/home or /home/boxuser. */
  command: string;
  /** Arguments passed before the SDK/backend prompt/model/session flags. */
  args?: string[];
  /** Streaming protocol emitted by the harness. Defaults to `box-sse-v1`. */
  protocol?: "box-sse-v1";
}

type ManagedAgentApiKeyConfig = {
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

type HarnessConfig =
  | {
      harness: Agent.ClaudeCode;
      model: ClaudeCode | OpenRouterModel | VercelModel;
      provider?: never;
      runner?: never;
    }
  | {
      harness: Agent.Codex;
      model: OpenAICodex | OpenRouterModel | VercelModel;
      provider?: never;
      runner?: never;
    }
  | {
      harness: Agent.OpenCode;
      model: OpenCodeModel | ClaudeCode | OpenAICodex | OpenRouterModel | VercelModel;
      provider?: never;
      runner?: never;
    }
  | { harness: Agent.Cursor; model: CursorModel; provider?: never; runner?: never }
  | { harness: string; model: string; provider?: never; runner?: never }
  | {
      /** @deprecated Use `harness` instead. */
      provider: Agent.ClaudeCode;
      model: ClaudeCode | OpenRouterModel | VercelModel;
      harness?: never;
      runner?: never;
    }
  | {
      /** @deprecated Use `harness` instead. */
      provider: Agent.Codex;
      model: OpenAICodex | OpenRouterModel | VercelModel;
      harness?: never;
      runner?: never;
    }
  | {
      /** @deprecated Use `harness` instead. */
      provider: Agent.OpenCode;
      model: OpenCodeModel | ClaudeCode | OpenAICodex | OpenRouterModel | VercelModel;
      harness?: never;
      runner?: never;
    }
  | {
      /** @deprecated Use `harness` instead. */
      provider: Agent.Cursor;
      model: CursorModel;
      harness?: never;
      runner?: never;
    }
  | {
      /** @deprecated Use `harness` instead. */
      provider: string;
      model: string;
      harness?: never;
      runner?: never;
    }
  | {
      /** @deprecated Use `harness` instead. */
      runner: Exclude<Agent, Agent.Custom>;
      model: OpenCodeModel | ClaudeCode | OpenAICodex | OpenRouterModel | VercelModel | CursorModel;
      harness?: never;
      provider?: never;
    }
  | {
      /** @deprecated Use `harness` instead. */
      runner: string;
      model: string;
      harness?: never;
      provider?: never;
    };

type CustomAgentConfig = {
  harness: Agent.Custom;
  /** Model label forwarded to the custom harness. Defaults to `custom`. */
  model?: string;
  /** Process to execute for custom agent runs. */
  customHarness: CustomHarnessConfig;
  /** Custom harnesses do not use managed provider keys; pass secrets through `env` if needed. */
  apiKey?: never;
  provider?: never;
  runner?: never;
};

/**
 * Agent configuration for a box.
 */
export type AgentConfig = CustomAgentConfig | (ManagedAgentApiKeyConfig & HarnessConfig);

// ==================== Agent Options ====================

/**
 * SDK-specific options forwarded to the Claude Code agent.
 */
export interface ClaudeCodeAgentOptions {
  /** Max conversation turns */
  maxTurns?: number;
  /** Max budget in USD */
  maxBudgetUsd?: number;
  /** Thinking depth */
  effort?: "low" | "medium" | "high" | "max";
  /** Thinking configuration */
  thinking?:
    | { type: "adaptive" }
    | { type: "enabled"; budgetTokens: number }
    | { type: "disabled" };
  /** Tools to deny */
  disallowedTools?: string[];
  /** Custom subagent definitions */
  agents?: Record<string, unknown>;
  /** Enable prompt suggestions */
  promptSuggestions?: boolean;
  /** Fallback model */
  fallbackModel?: string;
  /** Custom system prompt */
  systemPrompt?: string | Record<string, unknown>;
}

/**
 * SDK-specific options forwarded to the Codex agent.
 */
export interface CodexAgentOptions {
  /** Reasoning effort */
  modelReasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  /** Summary style */
  modelReasoningSummary?: "auto" | "concise" | "detailed" | "none";
  /** Agent personality */
  personality?: "friendly" | "pragmatic" | "none";
  /** Web search */
  webSearch?: "live" | boolean;
}

/**
 * SDK-specific options forwarded to the OpenCode agent.
 */
export interface OpenCodeAgentOptions {
  /** Reasoning effort */
  reasoningEffort?: "low" | "medium" | "high";
  /** Output verbosity */
  textVerbosity?: "low" | "medium" | "high";
  /** Summary mode */
  reasoningSummary?: "auto" | "concise" | "detailed" | "none";
  /** Thinking configuration for Anthropic models */
  thinking?: { type: "enabled"; budgetTokens: number };
}

/**
 * SDK-specific options forwarded to the Cursor agent.
 */
export type CursorAgentOptions = Record<string, unknown>;

/**
 * Resolves the correct agent options type based on the provider.
 */
export type AgentOptions<TProvider = unknown> = TProvider extends Agent.ClaudeCode
  ? ClaudeCodeAgentOptions
  : TProvider extends Agent.Codex
    ? CodexAgentOptions
    : TProvider extends Agent.OpenCode
      ? OpenCodeAgentOptions
      : TProvider extends Agent.Cursor
        ? CursorAgentOptions
        : Record<string, unknown>;

/**
 * Network access policy for a box.
 *
 * Controls which outbound destinations the box is allowed to reach.
 *
 * @example
 * ```ts
 * // Allow all outbound traffic (default)
 * { mode: "allow-all" }
 *
 * // Block all outbound traffic
 * { mode: "deny-all" }
 *
 * // Custom rules
 * { mode: "custom", allowedDomains: ["api.example.com"], deniedCidrs: ["10.0.0.0/8"] }
 * ```
 */
export type NetworkPolicy =
  | { mode: "allow-all" | "deny-all" }
  | {
      mode: "custom";
      allowedDomains?: string[];
      allowedCidrs?: string[];
      deniedCidrs?: string[];
    };

export interface BoxConfig extends BoxConnectionOptions {
  /** Human-readable name for the box */
  name?: string;
  /**
   * Labels to tag the box with, for organization and filtering.
   *
   * Each label may contain letters, digits, `.`, `_`, `-`, and `:`
   * (max 20 characters, up to 5 labels). Filter with `Box.list({ label })`,
   * and manage on a running box via `box.labels.add()` / `box.labels.remove()`.
   *
   * @example
   * ```ts
   * { labels: ["beta", "x-team"] }
   * ```
   */
  labels?: string[];
  runtime?: Runtime;
  /** Resource size for the box. Defaults to `"small"`. */
  size?: BoxSize;
  /**
   * Provision a headless browser (Chromium) usable via `box.browser`.
   */
  browser?: boolean;
  /** Keep the box alive instead of allowing pause-based idle lifecycle. */
  keepAlive?: boolean;
  /** Optional startup script for keep-alive boxes. */
  initCommand?: string;
  agent?: AgentConfig;
  git?: {
    token?: string;
    userName?: string;
    userEmail?: string;
  };
  env?: Record<string, string>;
  /**
   * Attach secret HTTP headers to outbound HTTPS requests from the box.
   *
   * Keys are host patterns (e.g. `"api.stripe.com"` or `"*.example.com"`),
   * values are objects mapping header names to header values.
   * A transparent proxy on the box agent injects these headers into
   * matching outbound requests.
   *
   * This field is **write-only** — it is never returned by GET endpoints.
   *
   * @example
   * ```ts
   * {
   *   attachHeaders: {
   *     "api.stripe.com": { Authorization: "Bearer sk_live_..." },
   *     "*.example.com": { "X-Custom-Token": "secret123" },
   *   }
   * }
   * ```
   */
  attachHeaders?: Record<string, Record<string, string>>;
  /** Network access policy — controls outbound connectivity */
  networkPolicy?: NetworkPolicy;
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
  timeout?: number;
  debug?: boolean;
}

/**
 * Configuration for creating an ephemeral box.
 *
 * Ephemeral boxes are lightweight, short-lived boxes that support only
 * exec and file operations. They are created synchronously (no polling)
 * and auto-delete after the configured TTL.
 */
export interface EphemeralBoxConfig extends BoxConnectionOptions {
  /** Human-readable name for the box */
  name?: string;
  /**
   * Labels to tag the box with, for organization and filtering.
   *
   * Each label may contain letters, digits, `.`, `_`, `-`, and `:`
   * (max 20 characters, up to 5 labels). Filter with `Box.list({ label })`.
   */
  labels?: string[];
  /** Runtime environment for the box. */
  runtime?: Runtime;
  /** Resource size for the box. Defaults to `"small"`. */
  size?: BoxSize;
  /** Time-to-live in seconds. Max 259200 (3 days). Defaults to 259200 if omitted. */
  ttl?: number;
  /** Environment variables to inject into the box. */
  env?: Record<string, string>;
  /**
   * Attach secret HTTP headers to outbound HTTPS requests from the box.
   *
   * Keys are host patterns (e.g. `"api.stripe.com"` or `"*.example.com"`),
   * values are objects mapping header names to header values.
   * This field is **write-only** — it is never returned by GET endpoints.
   */
  attachHeaders?: Record<string, Record<string, string>>;
  /** Network access policy — controls outbound connectivity */
  networkPolicy?: NetworkPolicy;
  /** Request timeout in milliseconds (defaults to 600000) */
  timeout?: number;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Response data for an ephemeral box, extending BoxData with ephemeral-specific fields.
 */
export interface EphemeralBoxData extends BoxData {
  ephemeral: boolean;
  expires_at: number;
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
  /** Optional custom headers to include in the webhook POST request */
  headers?: Record<string, string>;
}

export type Chunk =
  | { type: "start"; runId: string }
  | { type: "text-delta"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool-call"; toolCallId?: string; toolName: string; input: Record<string, unknown> }
  | { type: "tool-result"; toolCallId?: string; output: unknown }
  | {
      type: "finish";
      output: string;
      usage: {
        inputTokens: number;
        outputTokens: number;
        cachedInputTokens: number;
      };
      sessionId: string;
    }
  | { type: "stats"; cpuNs: number; memoryPeakBytes: number }
  | { type: "unknown"; event: string; data: unknown };

/**
 * Files to attach to a prompt. Two formats:
 *
 * - **Local file paths** (`string[]`) — read from disk and sent as multipart form data
 * - **Base64 data** — sent inline as JSON
 *
 * Max 10 files, 10 MB each.
 *
 * @example Local files (multipart)
 * ```ts
 * { files: ["./screenshot.png", "./report.pdf"] }
 * ```
 *
 * @example Base64 (JSON)
 * ```ts
 * { files: [{ data: "iVBORw0KGgo...", mediaType: "image/png", filename: "screenshot.png" }] }
 * ```
 */
export type PromptFiles = string[] | { data: string; mediaType: string; filename?: string }[];

/**
 * Options for streaming agent output
 */
export interface StreamOptions<TProvider = unknown> {
  /** The prompt/task for the AI agent */
  prompt: string;
  /** Files to attach to the prompt (images, PDFs, etc.) */
  files?: PromptFiles;
  /** SDK-specific options forwarded to the underlying agent */
  options?: AgentOptions<TProvider>;
  /** Timeout in milliseconds — aborts if exceeded */
  timeout?: number;
  /** Tool use callback — called when the agent invokes a tool (Read, Write, Bash, etc.) */
  onToolUse?: (tool: { toolCallId?: string; name: string; input: Record<string, unknown> }) => void;
  /** Tool result callback — called when a tool invocation completes */
  onToolResult?: (result: { toolCallId?: string; output: unknown }) => void;
}

/**
 * Options for running a prompt
 */
export interface RunOptions<T = undefined, TProvider = unknown> {
  /** The prompt/task for the AI agent */
  prompt: string;
  /** Zod schema for structured output — typed, validated results */
  responseSchema?: ZodType<T>;
  /** Files to attach to the prompt (images, PDFs, etc.) */
  files?: PromptFiles;
  /** SDK-specific options forwarded to the underlying agent */
  options?: AgentOptions<TProvider>;
  /** Timeout in milliseconds — aborts if exceeded */
  timeout?: number;
  /** Retries with exponential backoff on transient failures */
  maxRetries?: number;
  /** Tool use callback — called when the agent invokes a tool (Read, Write, Bash, etc.) */
  onToolUse?: (tool: { toolCallId?: string; name: string; input: Record<string, unknown> }) => void;
  /** Tool result callback — called when a tool invocation completes */
  onToolResult?: (result: { toolCallId?: string; output: unknown }) => void;
  /** Webhook — fire-and-forget, POST to URL on completion */
  webhook?: WebhookConfig;
}

export type BoxStatus = "creating" | "idle" | "running" | "paused" | "error" | "deleted";

export type RunStatus = "running" | "completed" | "failed" | "cancelled" | "detached";

export interface RunCost {
  /** Input tokens consumed */
  inputTokens: number;
  /** Output tokens consumed */
  outputTokens: number;
  /** Input tokens served from the provider's prompt cache (subset of inputTokens, billed at a discounted rate) */
  cachedInputTokens: number;
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
 * POST body sent by the backend to your webhook URL on run completion
 */
export interface WebhookPayload {
  box_id: string;
  status: "completed" | "failed";
  run_id?: string;
  output?: string;
  metadata?: Record<string, unknown>;
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
  status: "creating" | "ready" | "error" | "deleted";
  created_at: number;
}

/**
 * Shared connection options for static Box methods.
 */
export interface BoxConnectionOptions {
  /** Upstash Box API key. Falls back to UPSTASH_BOX_API_KEY env var. */
  apiKey?: string;
  /** Base URL of the Box API (defaults to https://us-east-1.box.upstash.com) */
  baseUrl?: string;
  /**
   * Send anonymous telemetry headers with API requests (defaults to `true`).
   * The `UPSTASH_DISABLE_TELEMETRY` env var overrides this to disabled where
   * an env is available; on runtimes without `process.env` (e.g. Cloudflare
   * Workers) this option is the only way to opt out.
   */
  enableTelemetry?: boolean;
}

/**
 * Options for listing boxes
 */
export interface ListOptions extends BoxConnectionOptions {
  /** Return only boxes carrying this label. */
  label?: string;
}

/**
 * Options for getting/reconnecting to an existing box
 */
export interface BoxGetOptions extends BoxConnectionOptions {
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
  /** Labels the box is tagged with. */
  labels?: string[];
  size?: BoxSize;
  keep_alive?: boolean;
  model?: string;
  agent?: Agent | string;
  enabled_skills?: string[];
  runtime?: string;
  /** Whether the box was provisioned with a headless browser (see `CreateBoxOptions.browser`). */
  browser?: boolean;
  status: BoxStatus;
  /**
   * Network access policy for this box. If omitted, defaults to allow-all
   */
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

export interface RunResult {
  output: string;
  metadata?: RunMetadata;
}

export interface RunMetadata {
  input_tokens?: number;
  output_tokens?: number;
  cached_input_tokens?: number;
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
  /** History depth (git clone --depth N); depth: 1 = shallow clone. Omit for a full clone. */
  depth?: number;
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

export interface GitCommitOptions {
  message: string;
  authorName?: string;
  authorEmail?: string;
}

export interface GitConfigUpdateOptions {
  userName?: string;
  userEmail?: string;
}

export interface GitConfig {
  git_user_name: string;
  git_user_email: string;
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
  cached_input_tokens?: number;
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

// ==================== Schedule ====================

export type ScheduleStatus = "active" | "paused" | "deleted";

/**
 * Options for creating an exec schedule
 */
export interface ExecScheduleOptions {
  /** Cron expression (e.g. "* * * * *"). UTC. */
  cron: string;
  /** Command and arguments to execute */
  command: string[];
  /** Working directory override */
  folder?: string;
  /** URL to POST results to after each run */
  webhookUrl?: string;
  /** Custom headers sent with webhook */
  webhookHeaders?: Record<string, string>;
}

/**
 * Options for creating a prompt schedule
 */
export interface AgentScheduleOptions<TProvider = unknown> {
  /** Cron expression (e.g. "0 9 * * *"). UTC. */
  cron: string;
  /** The prompt/task for the AI agent */
  prompt: string;
  /** Working directory override */
  folder?: string;
  /** Model override. Defaults to the box's configured model. */
  model?: string;
  /** SDK-specific options forwarded to the underlying agent */
  options?: AgentOptions<TProvider>;
  /** Timeout in milliseconds — kills the run if exceeded */
  timeout?: number;
  /** URL to POST results to after each run */
  webhookUrl?: string;
  /** Custom headers sent with webhook */
  webhookHeaders?: Record<string, string>;
}

export interface UpdateScheduleOptions<TProvider = unknown> {
  /** Cron expression (e.g. "0 9 * * *"). UTC. */
  cron?: string;
  /** Command and arguments to execute (exec schedules only) */
  command?: string[];
  /** The prompt/task for the AI agent (prompt schedules only) */
  prompt?: string;
  /** Working directory override */
  folder?: string;
  /** Model override */
  model?: string;
  /** SDK-specific options forwarded to the underlying agent; null clears */
  options?: AgentOptions<TProvider> | null;
  /** Timeout in milliseconds — kills the run if exceeded */
  timeout?: number;
  /** URL to POST results to after each run */
  webhookUrl?: string;
  /** Custom headers sent with webhook */
  webhookHeaders?: Record<string, string>;
}

/**
 * A scheduled task on a box
 */
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

// ==================== Public URLs ====================

/**
 * Public URL created for a box
 */
export interface PublicURL {
  /** Public URL to access the exposed port */
  url: string;
  /** Port number exposed */
  port: number;
  /** Bearer token (only returned when bearerToken is true) */
  token?: string;
  /** Basic auth username (only returned when basicAuth is true) */
  username?: string;
  /** Basic auth password (only returned when basicAuth is true) */
  password?: string;
}

/** @deprecated Use `PublicURL` instead. */
export type Preview = PublicURL;

// ==================== Browser ====================

/** Options for `box.browser.extract()` / `observe()` / `act()`. */
export interface BrowserExtractOptions {
  /**
   * Provider-prefixed model override, e.g. `anthropic/claude-sonnet-4-5` or
   * `openai/gpt-4o`. Defaults to the Box's configured model, or
   * `anthropic/claude-sonnet-4-5` when the Box has no model.
   */
  model?: string;
}

/** A link on the page. */
export interface BrowserLink {
  /** Link text. */
  text: string;
  /** Resolved href. */
  href: string;
}

/** Content of the active browser page (from `box.browser.goto/content`). */
export interface BrowserContent {
  title: string;
  url: string;
  text: string;
  links?: BrowserLink[];
}

/** Options for `tab.screenshot()`. */
export interface BrowserScreenshotOptions {
  /** Return PNG bytes by default, or a base64-encoded PNG string. */
  type?: "png" | "base64";
  /** Capture the full document instead of only the current viewport. Defaults to `false`. */
  fullPage?: boolean;
}

/** Navigation options for `box.browser.tab.create()`. */
export interface BrowserTabCreateOptions {
  /** Lifecycle state to wait for. Defaults to `"load"`. */
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
  /** Navigation timeout in milliseconds. Defaults to 30,000; `0` disables it. */
  timeout?: number;
}

/** One actionable element from `tab.observe()`. */
export interface BrowserObserveElement {
  description: string;
  /** A selector for the element (Stagehand-resolved), when available. */
  selector?: string;
  url?: string;
}

/** Result of `box.browser.observe()`. */
export interface BrowserObserveResult {
  elements: BrowserObserveElement[];
}

/** One action selected and executed by `tab.act()`. */
export interface BrowserActAction {
  selector: string;
  description: string;
  method?: string;
  arguments?: string[];
}

/** Result of one natural-language `tab.act()` call. */
export interface BrowserActResult {
  success: boolean;
  message: string;
  actionDescription: string;
  actions: BrowserActAction[];
  cacheStatus?: "HIT" | "MISS";
  inputTokens: number;
  outputTokens: number;
}

/** Options for `tab.run()`. */
export interface BrowserRunOptions<T = unknown> {
  /**
   * Zod object schema for data the agent must return when it completes. The
   * inferred schema output becomes `BrowserRunResult.data`.
   */
  schema?: { parse(data: unknown): T };
  /** @deprecated Pass the prompt as the first `tab.run()` argument. */
  prompt?: string;
  /** Max agent steps. Default 15, max 30. */
  maxSteps?: number;
  /**
   * Provider-prefixed model override, e.g. `anthropic/claude-sonnet-4-5`,
   * `openai/gpt-4o`, `openrouter/...`, `vercel/...`, `opencode/...`. The box or
   * account must have a key for that provider. Defaults to the Box's configured
   * model, or `anthropic/claude-sonnet-4-5` when the Box has no model.
   */
  model?: string;
}

/** One turn of a `tab.run()` loop. */
export interface BrowserRunStep {
  step: number;
  action?: string;
  reasoning?: string;
  url?: string;
}

/** Result of `tab.run()` — the agent's outcome after the loop. */
export interface BrowserRunResult<T = undefined> {
  /** Structured output validated against the supplied schema. */
  data: T;
  /** The agent's answer/summary when finished. */
  result: string;
  /** Whether the agent reported the task complete (vs. hit maxSteps). */
  completed: boolean;
  steps: BrowserRunStep[];
  stepCount: number;
  inputTokens: number;
  outputTokens: number;
}

/** A labeled point (or span) on a recording's timeline. */
export interface BrowserRecordingMarker {
  /** "tab_switch" (recorder-observed) or "run" (a `tab.run` chapter). */
  type: "tab_switch" | "run";
  /** Offset from the start of the recording, in milliseconds. */
  atMs: number;
  /** For spans (runs): end offset in milliseconds. */
  endMs?: number;
  /** Tab title/URL for switches; the prompt for runs. */
  label?: string;
  tabId?: string;
}

/** One captured browser session (HLS video + timeline metadata). */
export interface BrowserRecording {
  id: string;
  boxId: string;
  status: "recording" | "completed" | "failed" | "deleted";
  startedAt: number;
  /**
   * When the recording's stored video expires, in epoch milliseconds
   * (recordings are retained 14 days). Normalized from the API's epoch seconds.
   */
  expiresAt?: number;
  endedAt?: number;
  durationMs?: number;
  sizeBytes?: number;
  segmentCount?: number;
  /** Size of the downloadable MP4 in bytes; absent when the download falls back to MPEG-TS. */
  mp4SizeBytes?: number;
  /** Why the recording ended: "requested" | "max_duration" | "idle" | "browser_disconnected" | "lost". */
  stoppedReason?: string;
  maxDurationSeconds?: number;
  markers: BrowserRecordingMarker[];
  /**
   * HLS playlist URL for playback (hls.js / Safari / ffplay). Served by the
   * API — requests must authenticate like any other API call, e.g. with an
   * `X-Box-Api-Key: <apiKey>` header.
   */
  playlistUrl: string;
}

/** Options for `box.browser.recordings.start()`. */
export interface BrowserRecordingOptions {
  /** Auto-stop after this many seconds (default and maximum: 600 = 10 minutes). */
  maxDurationSeconds?: number;
}

/** Handle for an in-flight recording returned by `recordings.start()`. */
export interface BrowserRecordingHandle {
  id: string;
  /**
   * Finalize the recording: flush the encoder, upload, return metadata. If
   * this handle's recording already ended (e.g. auto-stopped), returns its
   * metadata without stopping whatever newer recording may be active.
   */
  stop: () => Promise<BrowserRecording>;
}
