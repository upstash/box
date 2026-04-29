import { zodToJsonSchema as zodToJsonSchemaLib } from "zod-to-json-schema";
import {
  type BoxConfig,
  type BoxConnectionOptions,
  type BoxData,
  type BoxGetOptions,
  type BoxRunData,
  type BoxSize,
  type ListOptions,
  type PromptFiles,
  type RunOptions,
  type StreamOptions,
  type Chunk,
  type RunStatus,
  type RunCost,
  type RunLog,
  type ExecResult,
  type CodeExecutionOptions,
  type CodeExecutionResult,
  type ExecStreamChunk,
  type ErrorResponse,
  type FileEntry,
  type GitCloneOptions,
  type GitExecOptions,
  type GitExecResult,
  type GitCheckoutOptions,
  type GitPROptions,
  type GitCommitOptions,
  type GitConfigUpdateOptions,
  type GitConfig,
  type GitCommitResult,
  type PullRequest,
  type LogEntry,
  type UploadFileEntry,
  type Snapshot,
  type Preview,
  type PublicURL,
  type EphemeralBoxConfig,
  type EphemeralBoxData,
  type NetworkPolicy,
  type ExecScheduleOptions,
  type AgentScheduleOptions,
  type Schedule,
  type ClaudeCodeAgentOptions,
  type CodexAgentOptions,
  type CursorAgentOptions,
  type OpenCodeAgentOptions,
  Agent,
} from "./types.js";
import type { ZodType } from "zod/v3";

const DEFAULT_BASE_URL = "https://us-east-1.box.upstash.com";

/** Infer the default harness from a model string prefix. */
export function inferDefaultProvider(model: string): Agent {
  if (model.startsWith("cursor/")) return Agent.Cursor;
  if (model.startsWith("openrouter/")) return Agent.ClaudeCode;
  if (model.startsWith("opencode/")) return Agent.OpenCode;
  if (model.startsWith("openai/")) return Agent.Codex;
  if (model.startsWith("anthropic/")) return Agent.ClaudeCode;
  return Agent.ClaudeCode;
}

/** @deprecated Use `inferDefaultProvider` instead. */
export const inferDefaultRunner = inferDefaultProvider;

/** Map of camelCase Codex option keys to their snake_case backend equivalents. */
const CODEX_KEY_MAP: Record<keyof CodexAgentOptions, string> = {
  modelReasoningEffort: "model_reasoning_effort",
  modelReasoningSummary: "model_reasoning_summary",
  personality: "personality",
  webSearch: "web_search",
};

/** Convert camelCase Codex agent options to the snake_case keys the backend expects. */
function toBackendAgentOptions(
  agent: Agent | undefined,
  options:
    | ClaudeCodeAgentOptions
    | CodexAgentOptions
    | CursorAgentOptions
    | OpenCodeAgentOptions
    | Record<string, unknown>,
): Record<string, unknown> {
  if (agent !== Agent.Codex) return options as Record<string, unknown>;
  const mapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options)) {
    mapped[CODEX_KEY_MAP[key as keyof CodexAgentOptions] ?? key] = value;
  }
  return mapped;
}

function resolveToolCallId(parsed: Record<string, unknown>): string | undefined {
  if (typeof parsed.tool_call_id === "string") return parsed.tool_call_id;
  if (typeof parsed.tool_use_id === "string") return parsed.tool_use_id;
  if (typeof parsed.toolCallId === "string") return parsed.toolCallId;
  if (typeof parsed.id === "string") return parsed.id;
  return undefined;
}

const EXEC_STREAM_EVENT_PREFIXES = ["event: exit\n", "event: error\n"] as const;

function safeExecOutputLength(buffer: string): number {
  const maxPrefixLength = Math.max(...EXEC_STREAM_EVENT_PREFIXES.map((prefix) => prefix.length));
  const maxSuffixLength = Math.min(buffer.length, maxPrefixLength - 1);

  for (let length = maxSuffixLength; length > 0; length--) {
    const suffix = buffer.slice(-length);
    if (EXEC_STREAM_EVENT_PREFIXES.some((prefix) => prefix.startsWith(suffix))) {
      return buffer.length - length;
    }
  }

  return buffer.length;
}

/**
 * Error thrown by the Box SDK
 */
export class BoxError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
  ) {
    super(message);
    this.name = "BoxError";
  }
}

function resolveAgentHarness(
  agent:
    | {
        harness?: string;
        provider?: string;
        runner?: string;
        model: string;
      }
    | undefined,
): string | undefined {
  if (!agent) return undefined;
  const harness = agent.harness ?? agent.provider ?? agent.runner;
  if (!harness) {
    throw new BoxError(
      "agent.harness is required. Deprecated aliases agent.provider and agent.runner are still accepted.",
    );
  }
  return harness;
}

/**
 * A run represents a single agent or shell execution.
 * Returned by box.agent.run() and box.exec.command().
 */
export class Run<T = string> {
  readonly type: "agent" | "command" | "code";

  private _id: string;
  private _result: T | null = null;
  private _status: RunStatus = "running";
  private _exitCode: number | null = null;
  private _inputTokens = 0;
  private _outputTokens = 0;
  private _computeMs = 0;
  private _box: Box;
  private _abortController?: AbortController;
  private _startTime: number;

  /** The run ID. Initially a local UUID, replaced by backend run_id from run_start event. */
  get id(): string {
    return this._id;
  }

  /** @internal */
  constructor(box: Box, type: "agent" | "command" | "code", id?: string) {
    this._id = id ?? crypto.randomUUID();
    this.type = type;
    this._box = box;
    this._startTime = Date.now();
  }

  /**
   * Final status of the run.
   */
  get status(): RunStatus {
    return this._status;
  }

  /**
   * The run result. Returns the typed output when responseSchema was provided.
   */
  get result(): T {
    if (this._result === null) {
      return "" as T;
    }
    return this._result;
  }

  /**
   * Process exit code. Only present for command and code runs — null for agent runs.
   */
  get exitCode(): number | null {
    return this._exitCode;
  }

  /**
   * Token usage and cost information.
   */
  get cost(): RunCost {
    return {
      inputTokens: this._inputTokens,
      outputTokens: this._outputTokens,
      computeMs: this._computeMs || Date.now() - this._startTime,
      totalUsd: 0,
    };
  }

  /**
   * Cancel a running execution.
   */
  async cancel(): Promise<void> {
    this._abortController?.abort();
    await this._box
      ._request("POST", `/v2/box/${this._box.id}/runs/${this._id}/cancel`)
      .catch(() => {});
    this._status = "cancelled";
  }

  /**
   * Retrieve logs for this run.
   */
  async logs(): Promise<RunLog[]> {
    const allLogs = await this._box.logs();
    // Filter logs around this run's time window
    const startSec = Math.floor(this._startTime / 1000);
    return allLogs
      .filter((l) => l.timestamp >= startSec)
      .map((l) => ({
        timestamp: new Date(l.timestamp * 1000).toISOString(),
        level: l.level,
        message: l.message,
      }));
  }

  /** @internal — Set internal fields from Box methods. */
  static _update<T>(
    run: Run<T>,
    data: {
      id?: string;
      result?: T | null;
      status?: RunStatus;
      exitCode?: number;
      inputTokens?: number;
      outputTokens?: number;
      computeMs?: number;
      abortController?: AbortController;
    },
  ): void {
    if (data.id !== undefined) run._id = data.id;
    if (data.result !== undefined) run._result = data.result;
    if (data.status !== undefined) run._status = data.status;
    if (data.exitCode !== undefined) run._exitCode = data.exitCode;
    if (data.inputTokens !== undefined) run._inputTokens = data.inputTokens;
    if (data.outputTokens !== undefined) run._outputTokens = data.outputTokens;
    if (data.computeMs !== undefined) run._computeMs = data.computeMs;
    if (data.abortController !== undefined) run._abortController = data.abortController;
  }
}

/**
 * A streaming run that can be iterated to receive chunks in real time.
 * Returned by box.agent.stream(), box.exec.stream(), and box.exec.streamCode().
 */
export class StreamRun<T = string, C = Chunk> extends Run<T> implements AsyncIterable<C> {
  private _iterator!: AsyncIterableIterator<C>;

  [Symbol.asyncIterator](): AsyncIterableIterator<C> {
    return this._iterator;
  }

  /** @internal — Set the async iterator from Box streaming methods. */
  static _setIterator<T, C>(run: StreamRun<T, C>, iterator: AsyncIterableIterator<C>): void {
    run._iterator = iterator;
  }
}

/**
 * A sandboxed AI coding environment.
 *
 * @example
 * ```ts
 * import { Box, ClaudeCode } from "@upstash/box";
 *
 * const box = await Box.create({
 *   runtime: "node",
 *   agent: { harness: Agent.ClaudeCode, model: ClaudeCode.Sonnet_4_5, apiKey: process.env.CLAUDE_KEY! },
 * });
 *
 * // Non-streaming
 * const run = await box.agent.run({ prompt: "Fix the bug in auth.ts" });
 * console.log(run.result);
 *
 * // Streaming
 * const stream = await box.agent.stream({ prompt: "Add tests" });
 * for await (const chunk of stream) {
 *   if (chunk.type === "text-delta") process.stdout.write(chunk.text);
 * }
 *
 * await box.delete();
 * ```
 */
export class Box<TProvider = unknown> {
  readonly id: string;

  /** Resource size of this box (`"small"`, `"medium"`, or `"large"`). */
  readonly size: BoxSize;

  /** Whether this box is configured as keep-alive. */
  readonly keepAlive: boolean;

  /** Current network access policy for this box. */
  get networkPolicy(): NetworkPolicy {
    return this._networkPolicy;
  }

  /** Agent operations namespace */
  readonly agent: {
    run<T>(
      options: RunOptions<T, TProvider> & {
        responseSchema: RunOptions<T, TProvider>["responseSchema"];
      },
    ): Promise<Run<T>>;
    run(options: RunOptions<undefined, TProvider>): Promise<Run<string>>;
    stream(options: StreamOptions<TProvider>): Promise<StreamRun<string, Chunk>>;
  };

  /** File operations namespace */
  readonly files: {
    read: (path: string, options?: { encoding?: "base64" }) => Promise<string>;
    write: (options: { path: string; content: string; encoding?: "base64" }) => Promise<void>;
    list: (path?: string) => Promise<FileEntry[]>;
    upload: (files: UploadFileEntry[]) => Promise<void>;
    /**
     * Download files from the box to the local filesystem.
     *
     * The `folder` option must point to a directory, not a single file.
     * When omitted, the entire workspace is downloaded.
     *
     * @example
     * ```ts
     * // Download a specific directory
     * await box.files.download({ folder: "src" });
     *
     * // Download the entire workspace
     * await box.files.download();
     * ```
     */
    download: (options?: { folder?: string }) => Promise<void>;
  };

  /** Execution namespace — shell commands and inline code */
  readonly exec: {
    command: (command: string) => Promise<Run<string>>;
    code: (options: CodeExecutionOptions) => Promise<Run<string>>;
    stream: (command: string) => Promise<StreamRun<string, ExecStreamChunk>>;
    streamCode: (options: CodeExecutionOptions) => Promise<StreamRun<string, ExecStreamChunk>>;
  };

  /** Schedule operations namespace */
  readonly schedule: {
    exec: (options: ExecScheduleOptions) => Promise<Schedule>;
    agent: (options: AgentScheduleOptions<TProvider>) => Promise<Schedule>;
    list: () => Promise<Schedule[]>;
    get: (id: string) => Promise<Schedule>;
    pause: (id: string) => Promise<void>;
    resume: (id: string) => Promise<void>;
    delete: (id: string) => Promise<void>;
  };

  /** Git operations namespace */
  readonly git: {
    clone: (options: GitCloneOptions) => Promise<void>;
    diff: () => Promise<string>;
    status: () => Promise<string>;
    commit: (options: GitCommitOptions) => Promise<GitCommitResult>;
    updateConfig: (options: GitConfigUpdateOptions) => Promise<GitConfig>;
    push: (options?: { branch?: string }) => Promise<void>;
    createPR: (options: GitPROptions) => Promise<PullRequest>;
    exec: (options: GitExecOptions) => Promise<GitExecResult>;
    checkout: (options: GitCheckoutOptions) => Promise<void>;
  };

  /** Skills namespace — manage platform skills from the Context7 registry */
  readonly skills: {
    /** Add a skill. Format: `owner/repo/skill-name`. */
    add: (skillId: string) => Promise<void>;
    /** Remove a skill. Format: `owner/repo/skill-name`. */
    remove: (skillId: string) => Promise<void>;
    /** List enabled skills for this box. */
    list: () => Promise<string[]>;
  };

  /**
   * The current working directory tracked in the SDK (not in the box).
   * Every new session starts at /workspace/home.
   */
  get cwd(): string {
    return this._cwd;
  }

  /** Current harness and model configured for this box. */
  get modelConfig(): {
    harness: Agent | undefined;
    /** @deprecated Use `harness`. */
    provider: Agent | undefined;
    /** @deprecated Use `harness`. */
    runner: Agent | undefined;
    model: string | undefined;
  } {
    return { harness: this._agent, provider: this._agent, runner: this._agent, model: this._model };
  }

  private _cwd: string;
  private _networkPolicy: NetworkPolicy;
  private _model: string | undefined;
  private _agent: Agent | undefined;
  private _baseUrl: string;
  private _headers: Record<string, string>;
  private _timeout: number;
  private _debug: boolean;
  private _gitToken?: string;
  private _isAgentConfigured: boolean;

  private _fs?: typeof import("node:fs/promises");
  private _path?: typeof import("node:path");

  private async _getFs() {
    if (!this._fs) {
      this._fs = await import("node:fs/promises");
    }
    return this._fs;
  }

  private async _getPath() {
    if (!this._path) {
      this._path = await import("node:path");
    }
    return this._path;
  }

  constructor(
    data: BoxData,
    config: {
      baseUrl: string;
      headers: Record<string, string>;
      timeout: number;
      debug: boolean;
      gitToken?: string;
      isAgentConfigured?: boolean;
    },
  ) {
    this.id = data.id;
    this.size = data.size ?? "small";
    this.keepAlive = Boolean(data.keep_alive);
    this._cwd = Box.WORKSPACE;
    this._networkPolicy = deserializeNetworkPolicy(data.network_policy);
    this._model = data.model;
    this._agent = data.agent;
    this._baseUrl = config.baseUrl;
    this._headers = config.headers;
    this._timeout = config.timeout;
    this._debug = config.debug;
    this._gitToken = config.gitToken;
    this._isAgentConfigured = config.isAgentConfigured ?? false;

    const self = this;
    this.agent = {
      run<T>(options: RunOptions<T>): Promise<Run<T | string>> {
        if (!self._isAgentConfigured) {
          throw new BoxError(
            'No agent configured. Pass an `agent` option to Box.create() to use box.agent.run().\n\nExample:\n  await Box.create({ agent: { harness: Agent.ClaudeCode, model: ClaudeCode.Sonnet_4_5, apiKey: "sk-..." } })',
          );
        }
        return self._run(options);
      },
      stream(options: StreamOptions): Promise<StreamRun<string, Chunk>> {
        if (!self._isAgentConfigured) {
          throw new BoxError(
            'No agent configured. Pass an `agent` option to Box.create() to use box.agent.stream().\n\nExample:\n  await Box.create({ agent: { harness: Agent.ClaudeCode, model: ClaudeCode.Sonnet_4_5, apiKey: "sk-..." } })',
          );
        }
        return self._stream(options);
      },
    } as this["agent"];

    this.exec = {
      command: (command) => this._execCommand(command),
      code: (options) => this._execCode(options),
      stream: (command) => this._execStream(command),
      streamCode: (options) => this._execStreamCode(options),
    };

    this.files = {
      read: (path, options) => this._readFile(path, options?.encoding),
      write: (opts) => this._writeFile(opts.path, opts.content, opts.encoding),
      list: (path) => this._listFiles(path),
      upload: (files) => this._uploadFiles(files),
      download: (opts) => this._downloadFiles(opts?.folder),
    };

    this.schedule = {
      exec: (options) => this._scheduleExec(options),
      agent: (options) => this._scheduleAgent(options),
      list: () => this._scheduleList(),
      get: (id) => this._scheduleGet(id),
      pause: (id) => this._schedulePause(id),
      resume: (id) => this._scheduleResume(id),
      delete: (id) => this._scheduleDelete(id),
    };

    this.git = {
      clone: (options) => this._gitClone(options),
      diff: () => this._gitDiff(),
      status: () => this._gitStatus(),
      commit: (options) => this._gitCommit(options),
      updateConfig: (options) => this._gitUpdateConfig(options),
      push: (options) => this._gitPush(options),
      createPR: (options) => this._gitCreatePR(options),
      exec: (options) => this._gitExec(options),
      checkout: (options) => this._gitCheckout(options),
    };

    this.skills = {
      add: (skillId) => this._skillAdd(skillId),
      remove: (skillId) => this._skillRemove(skillId),
      list: () => this._skillList(),
    };
  }

  /**
   * Create a new sandboxed box.
   */
  static async create<TProvider = unknown>(config?: BoxConfig): Promise<Box<TProvider>> {
    const apiKey = config?.apiKey ?? process.env.UPSTASH_BOX_API_KEY;
    if (!apiKey) {
      throw new BoxError(
        "apiKey is required. Pass it in config or set UPSTASH_BOX_API_KEY env var.",
      );
    }
    if (config?.agent && !config.agent.model) {
      throw new BoxError("agent.model is required when agent is configured");
    }
    if (config?.initCommand !== undefined && !config.keepAlive) {
      throw new BoxError("initCommand requires keepAlive: true");
    }
    const baseUrl = (
      config?.baseUrl ??
      process.env.UPSTASH_BOX_BASE_URL ??
      DEFAULT_BASE_URL
    ).replace(/\/$/, "");
    const headers: Record<string, string> = {
      "X-Box-Api-Key": apiKey,
    };
    const timeout = config?.timeout ?? 600000;
    const debug = config?.debug ?? false;

    const body: Record<string, unknown> = {};
    if (config?.name) body.name = config.name;
    if (config?.size) body.size = config.size;
    if (config?.keepAlive) body.keep_alive = true;
    if (config?.initCommand !== undefined) body.init_command = config.initCommand;
    if (config?.agent) {
      body.model = config.agent.model;
      body.agent = resolveAgentHarness(config.agent);
      body.agent_api_key = config.agent.apiKey;
    }
    if (config?.runtime) body.runtime = config.runtime;
    if (config?.git?.token) body.github_token = config.git.token;
    if (config?.git?.userName) body.git_user_name = config.git.userName;
    if (config?.git?.userEmail) body.git_user_email = config.git.userEmail;
    if (config?.env) body.env_vars = config.env;
    if (config?.attachHeaders) body.attach_headers = config.attachHeaders;
    if (config?.networkPolicy) body.network_policy = serializeNetworkPolicy(config.networkPolicy);
    if (config?.skills?.length) body.skills = config.skills;
    if (config?.mcpServers?.length) {
      body.mcp_servers = config.mcpServers.map((s) => ({
        name: s.name,
        ...("package" in s
          ? { source: "npm", package_or_url: s.package, args: s.args }
          : { source: "url", package_or_url: s.url, headers: s.headers }),
      }));
    }

    const response = await fetch(`${baseUrl}/v2/box`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const msg = await parseErrorResponse(response);
      throw new BoxError(msg, response.status);
    }

    let data = (await response.json()) as BoxData;

    // Poll until ready
    const pollInterval = 2000;
    const maxWait = 300000;
    const start = Date.now();

    while (data.status === "creating" && Date.now() - start < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      const pollResponse = await fetch(`${baseUrl}/v2/box/${data.id}`, { headers });
      if (pollResponse.ok) {
        data = (await pollResponse.json()) as BoxData;
      }
    }

    if (data.status === "creating") {
      throw new BoxError("Box creation timed out");
    }
    if (data.status === "error") {
      throw new BoxError("Box creation failed");
    }

    return new Box(data, {
      baseUrl,
      headers,
      timeout,
      debug,
      gitToken: config?.git?.token,
      isAgentConfigured: Boolean(data.agent),
    });
  }

  /**
   * List all boxes for the authenticated user.
   */
  static async list(options?: ListOptions): Promise<BoxData[]> {
    const apiKey = options?.apiKey ?? process.env.UPSTASH_BOX_API_KEY;
    if (!apiKey) {
      throw new BoxError(
        "apiKey is required. Pass it in options or set UPSTASH_BOX_API_KEY env var.",
      );
    }

    const baseUrl = (
      options?.baseUrl ??
      process.env.UPSTASH_BOX_BASE_URL ??
      DEFAULT_BASE_URL
    ).replace(/\/$/, "");
    const headers: Record<string, string> = { "X-Box-Api-Key": apiKey };

    const response = await fetch(`${baseUrl}/v2/box`, { headers });
    if (!response.ok) {
      const msg = await parseErrorResponse(response);
      throw new BoxError(msg, response.status);
    }

    return (await response.json()) as BoxData[];
  }

  /**
   * Delete specific boxes by ID.
   */
  static async delete(
    options: BoxConnectionOptions & { boxIds: string | string[] },
  ): Promise<void> {
    const apiKey = options.apiKey ?? process.env.UPSTASH_BOX_API_KEY;
    if (!apiKey) {
      throw new BoxError(
        "apiKey is required. Pass it in options or set UPSTASH_BOX_API_KEY env var.",
      );
    }

    const baseUrl = (
      options.baseUrl ??
      process.env.UPSTASH_BOX_BASE_URL ??
      DEFAULT_BASE_URL
    ).replace(/\/$/, "");
    const headers: Record<string, string> = {
      "X-Box-Api-Key": apiKey,
      "Content-Type": "application/json",
    };

    const ids = Array.isArray(options.boxIds) ? options.boxIds : [options.boxIds];
    const response = await fetch(`${baseUrl}/v2/box`, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ ids }),
    });
    if (!response.ok) {
      const msg = await parseErrorResponse(response);
      throw new BoxError(msg, response.status);
    }
  }

  /**
   * Get an existing box by ID
   */
  static async get<TProvider = unknown>(
    boxId: string,
    options?: BoxGetOptions,
  ): Promise<Box<TProvider>> {
    const apiKey = options?.apiKey ?? process.env.UPSTASH_BOX_API_KEY;
    if (!apiKey) {
      throw new BoxError(
        "apiKey is required. Pass it in options or set UPSTASH_BOX_API_KEY env var.",
      );
    }

    const baseUrl = (
      options?.baseUrl ??
      process.env.UPSTASH_BOX_BASE_URL ??
      DEFAULT_BASE_URL
    ).replace(/\/$/, "");
    const headers: Record<string, string> = { "X-Box-Api-Key": apiKey };
    const timeout = options?.timeout ?? 600000;
    const debug = options?.debug ?? false;

    const response = await fetch(`${baseUrl}/v2/box/${boxId}`, { headers });
    if (!response.ok) {
      const msg = await parseErrorResponse(response);
      throw new BoxError(msg, response.status);
    }

    const data = (await response.json()) as BoxData;
    return new Box(data, {
      baseUrl,
      headers,
      timeout,
      debug,
      gitToken: options?.gitToken,
      isAgentConfigured: Boolean(data.model),
    });
  }

  /**
   * Get an existing box by name
   */
  static getByName = Box.get;

  /** Upsert a single user-level env var. */
  static async setEnv(key: string, value: string, options?: BoxConnectionOptions): Promise<void> {
    const apiKey = options?.apiKey ?? process.env.UPSTASH_BOX_API_KEY;
    if (!apiKey)
      throw new BoxError(
        "apiKey is required. Pass it in options or set UPSTASH_BOX_API_KEY env var.",
      );
    const baseUrl = (
      options?.baseUrl ??
      process.env.UPSTASH_BOX_BASE_URL ??
      DEFAULT_BASE_URL
    ).replace(/\/$/, "");
    const headers = { "X-Box-Api-Key": apiKey };
    const response = await fetch(`${baseUrl}/v2/box/settings/env/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
    if (!response.ok) throw new BoxError(await parseErrorResponse(response), response.status);
  }

  /** List all user-level env vars. Values are masked. */
  static async listEnv(options?: BoxConnectionOptions): Promise<Record<string, string>> {
    const apiKey = options?.apiKey ?? process.env.UPSTASH_BOX_API_KEY;
    if (!apiKey)
      throw new BoxError(
        "apiKey is required. Pass it in options or set UPSTASH_BOX_API_KEY env var.",
      );
    const baseUrl = (
      options?.baseUrl ??
      process.env.UPSTASH_BOX_BASE_URL ??
      DEFAULT_BASE_URL
    ).replace(/\/$/, "");
    const headers = { "X-Box-Api-Key": apiKey };
    const response = await fetch(`${baseUrl}/v2/box/settings/env`, { headers });
    if (!response.ok) throw new BoxError(await parseErrorResponse(response), response.status);
    const data = (await response.json()) as { env_vars?: Record<string, string> };
    return data.env_vars ?? (data as unknown as Record<string, string>);
  }

  /** Delete a single user-level env var. */
  static async deleteEnv(key: string, options?: BoxConnectionOptions): Promise<void> {
    const apiKey = options?.apiKey ?? process.env.UPSTASH_BOX_API_KEY;
    if (!apiKey)
      throw new BoxError(
        "apiKey is required. Pass it in options or set UPSTASH_BOX_API_KEY env var.",
      );
    const baseUrl = (
      options?.baseUrl ??
      process.env.UPSTASH_BOX_BASE_URL ??
      DEFAULT_BASE_URL
    ).replace(/\/$/, "");
    const headers = { "X-Box-Api-Key": apiKey };
    const response = await fetch(`${baseUrl}/v2/box/settings/env/${encodeURIComponent(key)}`, {
      method: "DELETE",
      headers,
    });
    if (!response.ok) throw new BoxError(await parseErrorResponse(response), response.status);
  }

  /** Full-replace all user-level env vars. Any key not listed will be removed. */
  static async setAllEnv(
    vars: Record<string, string>,
    options?: BoxConnectionOptions,
  ): Promise<void> {
    const apiKey = options?.apiKey ?? process.env.UPSTASH_BOX_API_KEY;
    if (!apiKey)
      throw new BoxError(
        "apiKey is required. Pass it in options or set UPSTASH_BOX_API_KEY env var.",
      );
    const baseUrl = (
      options?.baseUrl ??
      process.env.UPSTASH_BOX_BASE_URL ??
      DEFAULT_BASE_URL
    ).replace(/\/$/, "");
    const headers = { "X-Box-Api-Key": apiKey };
    const response = await fetch(`${baseUrl}/v2/box/settings/env`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ env_vars: vars }),
    });
    if (!response.ok) throw new BoxError(await parseErrorResponse(response), response.status);
  }

  // ==================== Run ====================

  /** @internal */
  private async _run<T>(options: RunOptions<T>): Promise<Run<T | string>> {
    if (!options.prompt) throw new BoxError("prompt is required");

    // Webhook mode: pass webhook to backend, which returns immediately
    if (options.webhook) {
      return this._executeWebhookRun(options);
    }

    return this._runWithRetries(options);
  }

  /** @internal — Webhook run: sends webhook config to backend, returns immediately with accepted response. */
  private async _executeWebhookRun<T>(options: RunOptions<T>): Promise<Run<T | string>> {
    if (!options.webhook) {
      throw new BoxError("webhook is required for webhook runs");
    }

    const run = new Run<T | string>(this, "agent");

    const requestBody: Record<string, unknown> = { prompt: options.prompt };
    const folder = this._getFolder();
    if (folder) requestBody.folder = folder;
    if (options.responseSchema) {
      const jsonSchema = toJsonSchema(options.responseSchema);
      if (jsonSchema) {
        requestBody.json_schema = jsonSchema;
      }
    }
    if (options.options)
      requestBody.agent_options = toBackendAgentOptions(this._agent, options.options);
    requestBody.webhook = options.webhook.headers
      ? { url: options.webhook.url, headers: options.webhook.headers }
      : { url: options.webhook.url };

    const url = `${this._baseUrl}/v2/box/${this.id}/run`;
    const { body: fetchBody, headers: fetchHeaders } = await buildRunRequest(
      this._headers,
      requestBody,
      options.files,
    );

    const response = await fetch(url, {
      method: "POST",
      headers: fetchHeaders,
      body: fetchBody,
    });

    if (!response.ok) {
      const msg = await parseErrorResponse(response);
      throw new BoxError(msg, response.status);
    }

    const data = (await response.json()) as { status: string; run_id: string };
    Run._update(run, { id: data.run_id, status: "running" });

    return run;
  }

  private async _runWithRetries<T>(options: RunOptions<T>): Promise<Run<T | string>> {
    const maxRetries = options.maxRetries ?? 0;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this._executeRun(options, attempt);
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  private async _executeRun<T>(options: RunOptions<T>, _attempt: number): Promise<Run<T | string>> {
    const start = Date.now();
    const run = new Run<T | string>(this, "agent");
    const abortController = new AbortController();
    Run._update(run, { abortController });

    if (options.timeout) {
      setTimeout(() => abortController.abort(), options.timeout);
    }

    const requestBody: Record<string, unknown> = { prompt: options.prompt };
    const folder = this._getFolder();
    if (folder) requestBody.folder = folder;
    if (options.responseSchema) {
      const jsonSchema = toJsonSchema(options.responseSchema);
      if (jsonSchema) {
        requestBody.json_schema = jsonSchema;
      }
    }
    if (options.options)
      requestBody.agent_options = toBackendAgentOptions(this._agent, options.options);

    const url = `${this._baseUrl}/v2/box/${this.id}/run/stream`;
    const { body: fetchBody, headers: fetchHeaders } = await buildRunRequest(
      this._headers,
      requestBody,
      options.files,
    );

    const response = await fetch(url, {
      method: "POST",
      headers: fetchHeaders,
      body: fetchBody,
      signal: abortController.signal,
    });

    if (!response.ok) {
      const msg = await parseErrorResponse(response);
      throw new BoxError(msg, response.status);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new BoxError("Streaming not supported");

    const decoder = new TextDecoder();
    let buffer = "";
    let eventType = "";
    let eventData = "";
    let rawOutput = "";

    const processEvent = (type: string, data: string) => {
      try {
        const parsed = JSON.parse(data);
        switch (type) {
          case "run_start": {
            if (parsed.run_id) Run._update(run, { id: parsed.run_id });
            break;
          }
          case "text": {
            const text = parsed.text ?? "";
            if (text) {
              rawOutput += text;
            }
            break;
          }
          case "tool": {
            const toolCallId = resolveToolCallId(parsed);
            options.onToolUse?.({
              toolCallId,
              name: parsed.name ?? "",
              input: parsed.input ?? {},
            });
            break;
          }
          case "tool_result": {
            const toolCallId = resolveToolCallId(parsed);
            options.onToolResult?.({
              toolCallId,
              output: parsed.output,
            });
            break;
          }
          case "done": {
            Run._update(run, {
              inputTokens: parsed.input_tokens ?? 0,
              outputTokens: parsed.output_tokens ?? 0,
            });
            if (parsed.output) rawOutput = parsed.output;
            break;
          }
          case "error":
            throw new BoxError(parsed.error ?? "Stream error");
        }
      } catch (e) {
        if (e instanceof BoxError) throw e;
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        let chunk = decoder.decode(value, { stream: true });
        chunk = chunk.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
        buffer += chunk;

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (let line of lines) {
          line = line.replace(/\r$/, "").replace(/^[\\\|\/\-\s]*/, "");

          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            eventData = line.slice(6);
          } else if ((line === "" || line.trim() === "") && eventType && eventData) {
            processEvent(eventType, eventData);
            eventType = "";
            eventData = "";
          }
        }

        if (eventType && eventData && (buffer === "" || buffer.trim() === "")) {
          processEvent(eventType, eventData);
          eventType = "";
          eventData = "";
        }
      }

      // Process remaining buffer
      if (eventType && eventData) {
        processEvent(eventType, eventData);
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        Run._update(run, { status: "cancelled", computeMs: Date.now() - start });
        throw new BoxError("Run timed out");
      }
      throw e;
    }

    // Parse structured output if schema provided
    let output: T | string = rawOutput.trim();
    if (options.responseSchema) {
      try {
        const parsed = JSON.parse(output);
        output = options.responseSchema.parse(parsed);
      } catch (e) {
        throw new BoxError(
          `Failed to parse structured output: ${e instanceof Error ? e.message : e}\n\nRaw output: ${(output as string).slice(0, 500)}`,
        );
      }
    }

    Run._update(run, { result: output, status: "completed", computeMs: Date.now() - start });

    return run;
  }

  private async _stream(options: StreamOptions): Promise<StreamRun<string, Chunk>> {
    if (!options.prompt) throw new BoxError("prompt is required");

    const start = Date.now();
    const run = new StreamRun<string, Chunk>(this, "agent");
    const abortController = new AbortController();
    Run._update(run, { abortController });

    if (options.timeout) {
      setTimeout(() => abortController.abort(), options.timeout);
    }

    const folder = this._getFolder();
    const requestBody: Record<string, unknown> = { prompt: options.prompt };
    if (folder) requestBody.folder = folder;
    if (options.options)
      requestBody.agent_options = toBackendAgentOptions(this._agent, options.options);

    const url = `${this._baseUrl}/v2/box/${this.id}/run/stream`;
    const { body: fetchBody, headers: fetchHeaders } = await buildRunRequest(
      this._headers,
      requestBody,
      options.files,
    );

    const response = await fetch(url, {
      method: "POST",
      headers: fetchHeaders,
      body: fetchBody,
      signal: abortController.signal,
    });

    if (!response.ok) {
      const msg = await parseErrorResponse(response);
      throw new BoxError(msg, response.status);
    }

    const bodyReader = response.body?.getReader();
    if (!bodyReader) throw new BoxError("Streaming not supported");
    const reader = bodyReader;

    let rawOutput = "";

    const processEvent = (type: string, data: string): Chunk | null => {
      try {
        const parsed = JSON.parse(data);
        switch (type) {
          case "run_start": {
            if (parsed.run_id) Run._update(run, { id: parsed.run_id });
            const chunk: Chunk = { type: "start", runId: parsed.run_id ?? "" };
            return chunk;
          }
          case "text": {
            const text = parsed.text ?? "";
            if (text) {
              rawOutput += text;
              const chunk: Chunk = { type: "text-delta", text };
              return chunk;
            }
            return null;
          }
          case "thinking": {
            const text = parsed.text ?? "";
            if (text) {
              const chunk: Chunk = { type: "reasoning", text };
              return chunk;
            }
            return null;
          }
          case "tool": {
            const toolCallId = resolveToolCallId(parsed);
            const chunk: Chunk = {
              type: "tool-call",
              toolCallId,
              toolName: parsed.name ?? "",
              input: parsed.input ?? {},
            };
            options.onToolUse?.({
              toolCallId,
              name: parsed.name ?? "",
              input: parsed.input ?? {},
            });
            return chunk;
          }
          case "tool_result": {
            const toolCallId = resolveToolCallId(parsed);
            const chunk: Chunk = {
              type: "tool-result",
              toolCallId,
              output: parsed.output,
            };
            options.onToolResult?.({
              toolCallId,
              output: parsed.output,
            });
            return chunk;
          }
          case "done": {
            Run._update(run, {
              inputTokens: parsed.input_tokens ?? 0,
              outputTokens: parsed.output_tokens ?? 0,
            });
            if (parsed.output) rawOutput = parsed.output;
            const chunk: Chunk = {
              type: "finish",
              output: parsed.output ?? "",
              usage: {
                inputTokens: parsed.input_tokens ?? 0,
                outputTokens: parsed.output_tokens ?? 0,
              },
              sessionId: parsed.session_id ?? "",
            };
            return chunk;
          }
          case "stats": {
            const chunk: Chunk = {
              type: "stats",
              cpuNs: parsed.cpu_ns ?? 0,
              memoryPeakBytes: parsed.memory_peak_bytes ?? 0,
            };
            return chunk;
          }
          case "error":
            throw new BoxError(parsed.error ?? "Stream error");
          default: {
            const chunk: Chunk = { type: "unknown", event: type, data: parsed };
            return chunk;
          }
        }
      } catch (e) {
        if (e instanceof BoxError) throw e;
        return null;
      }
    };

    async function* iterate(): AsyncGenerator<Chunk> {
      const decoder = new TextDecoder();
      let buffer = "";
      let eventType = "";
      let eventData = "";
      let finished = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          let chunk = decoder.decode(value, { stream: true });
          chunk = chunk.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
          buffer += chunk;

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (let line of lines) {
            line = line.replace(/\r$/, "").replace(/^[\\\|\/\-\s]*/, "");

            if (line.startsWith("event: ")) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              eventData = line.slice(6);
            } else if ((line === "" || line.trim() === "") && eventType && eventData) {
              const parsed = processEvent(eventType, eventData);
              if (parsed !== null) yield parsed;
              eventType = "";
              eventData = "";
            }
          }

          if (eventType && eventData && (buffer === "" || buffer.trim() === "")) {
            const parsed = processEvent(eventType, eventData);
            if (parsed !== null) yield parsed;
            eventType = "";
            eventData = "";
          }
        }

        if (eventType && eventData) {
          const parsed = processEvent(eventType, eventData);
          if (parsed !== null) yield parsed;
        }

        finished = true;
        Run._update(run, {
          result: rawOutput.trim(),
          status: "completed",
          computeMs: Date.now() - start,
        });
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") {
          Run._update(run, { status: "cancelled", computeMs: Date.now() - start });
          throw new BoxError("Stream timed out");
        }
        Run._update(run, {
          result: rawOutput.trim(),
          status: "failed",
          computeMs: Date.now() - start,
        });
        throw e;
      } finally {
        if (!finished) {
          // Early termination (consumer break/return) — run may still be executing server-side
          if (run.status === "running") {
            Run._update(run, {
              result: rawOutput.trim(),
              status: "detached",
              computeMs: Date.now() - start,
            });
          }
        }
        try {
          reader.cancel();
        } catch {
          // ignore cancel errors
        }
      }
    }

    StreamRun._setIterator(run, iterate());
    return run;
  }

  // ==================== Execution ====================

  /**
   * Execute an OS-level command in the box.
   */
  private async _execCommand(command: string): Promise<Run<string>> {
    const start = Date.now();
    const folder = this._getFolder();
    const result = await this._request<ExecResult>("POST", `/v2/box/${this.id}/exec`, {
      body: { command: ["sh", "-c", command], ...(folder ? { folder } : {}) },
    });

    const run = new Run<string>(this, "command");
    Run._update(run, {
      result: result.error ? result.error : result.output,
      status: result.exit_code === 0 ? "completed" : "failed",
      exitCode: result.exit_code,
      computeMs: Date.now() - start,
    });
    return run;
  }

  /**
   * Execute inline code (JS, TS, or Python) inside the box.
   */
  private async _execCode(options: CodeExecutionOptions): Promise<Run<string>> {
    const start = Date.now();
    const folder = this._getFolder();
    const result = await this._request<CodeExecutionResult>("POST", `/v2/box/${this.id}/code`, {
      body: {
        code: options.code,
        language: options.lang,
        ...(options.timeout !== undefined && { timeout: options.timeout }),
        ...(folder ? { folder } : {}),
      },
    });

    const run = new Run<string>(this, "code");
    Run._update(run, {
      result: result.error ? result.error : result.output,
      status: result.exit_code === 0 ? "completed" : "failed",
      exitCode: result.exit_code,
      computeMs: Date.now() - start,
    });
    return run;
  }

  /**
   * Stream output from a shell command executed in the box.
   */
  private async _execStream(command: string): Promise<StreamRun<string, ExecStreamChunk>> {
    const run = new StreamRun<string, ExecStreamChunk>(this, "command");
    const start = Date.now();

    const folder = this._getFolder();
    const url = `${this._baseUrl}/v2/box/${this.id}/exec-stream`;
    const response = await fetch(url, {
      method: "POST",
      headers: { ...this._headers, "Content-Type": "application/json" },
      body: JSON.stringify({ command: ["sh", "-c", command], ...(folder ? { folder } : {}) }),
    });

    if (!response.ok) {
      const msg = await parseErrorResponse(response);
      throw new BoxError(msg, response.status);
    }

    const self = this;
    let fullOutput = "";

    async function* iterate(): AsyncGenerator<ExecStreamChunk> {
      let finished = false;
      try {
        for await (const chunk of self._parseExecStream(response)) {
          if (chunk.type === "output") {
            fullOutput += chunk.data;
          } else if (chunk.type === "exit") {
            Run._update(run, {
              exitCode: chunk.exitCode,
              status: chunk.exitCode === 0 ? "completed" : "failed",
            });
          }
          yield chunk;
        }
        finished = true;
        Run._update(run, { result: fullOutput, computeMs: Date.now() - start });
        if (run.status === "running") Run._update(run, { status: "completed" });
      } catch (e) {
        Run._update(run, {
          result: fullOutput,
          status: "failed",
          computeMs: Date.now() - start,
        });
        throw e;
      } finally {
        if (!finished && run.status === "running") {
          Run._update(run, {
            result: fullOutput,
            status: "detached",
            computeMs: Date.now() - start,
          });
        }
      }
    }

    StreamRun._setIterator(run, iterate());
    return run;
  }

  /**
   * Stream output from inline code execution in the box.
   */
  private async _execStreamCode(
    options: CodeExecutionOptions,
  ): Promise<StreamRun<string, ExecStreamChunk>> {
    const run = new StreamRun<string, ExecStreamChunk>(this, "code");
    const start = Date.now();

    const folder = this._getFolder();
    const url = `${this._baseUrl}/v2/box/${this.id}/code-stream`;
    const response = await fetch(url, {
      method: "POST",
      headers: { ...this._headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        code: options.code,
        language: options.lang,
        ...(options.timeout !== undefined && { timeout: options.timeout }),
        ...(folder ? { folder } : {}),
      }),
    });

    if (!response.ok) {
      const msg = await parseErrorResponse(response);
      throw new BoxError(msg, response.status);
    }

    const self = this;
    let fullOutput = "";

    async function* iterate(): AsyncGenerator<ExecStreamChunk> {
      let finished = false;
      try {
        for await (const chunk of self._parseExecStream(response)) {
          if (chunk.type === "output") {
            fullOutput += chunk.data;
          } else if (chunk.type === "exit") {
            Run._update(run, {
              exitCode: chunk.exitCode,
              status: chunk.exitCode === 0 ? "completed" : "failed",
            });
          }
          yield chunk;
        }
        finished = true;
        Run._update(run, { result: fullOutput, computeMs: Date.now() - start });
        if (run.status === "running") Run._update(run, { status: "completed" });
      } catch (e) {
        Run._update(run, {
          result: fullOutput,
          status: "failed",
          computeMs: Date.now() - start,
        });
        throw e;
      } finally {
        if (!finished && run.status === "running") {
          Run._update(run, {
            result: fullOutput,
            status: "detached",
            computeMs: Date.now() - start,
          });
        }
      }
    }

    StreamRun._setIterator(run, iterate());
    return run;
  }

  /**
   * Shared parser for exec-stream / code-stream responses.
   * Reads raw text chunks and detects the trailing SSE `event: exit` boundary.
   */
  private async *_parseExecStream(response: Response): AsyncGenerator<ExecStreamChunk> {
    const reader = response.body?.getReader();
    if (!reader) throw new BoxError("Streaming not supported");

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Check for SSE error event
        const errorIndex = buffer.indexOf("event: error\n");
        if (errorIndex !== -1) {
          const afterEvent = buffer.slice(errorIndex + "event: error\n".length);
          const dataMatch = afterEvent.match(/^data:\s*(.+)/m);
          if (dataMatch) {
            try {
              const parsed = JSON.parse(dataMatch[1]!);
              throw new BoxError(parsed.error ?? "Stream error");
            } catch (e) {
              if (e instanceof BoxError) throw e;
              throw new BoxError("Stream error");
            }
          }
          throw new BoxError("Stream error");
        }

        const exitIndex = buffer.indexOf("event: exit\n");
        if (exitIndex === -1) {
          // No complete event yet. Keep a small suffix so markers split across
          // network chunks (`event: ex` + `it\n...`) are not emitted as output.
          const outputLength = safeExecOutputLength(buffer);
          if (outputLength > 0) {
            yield { type: "output", data: buffer.slice(0, outputLength) };
            buffer = buffer.slice(outputLength);
          }
          continue;
        }

        // Yield any raw output before the exit event
        if (exitIndex > 0) {
          yield { type: "output", data: buffer.slice(0, exitIndex) };
        }

        // Parse the exit event
        const afterEvent = buffer.slice(exitIndex + "event: exit\n".length);
        const dataMatch = afterEvent.match(/^data:\s*(.+)/m);
        if (dataMatch) {
          try {
            const parsed = JSON.parse(dataMatch[1]!);
            yield {
              type: "exit",
              exitCode: parsed.exit_code ?? 0,
              cpuNs: parsed.cpu_ns ?? 0,
            };
          } catch {
            yield { type: "exit", exitCode: 0, cpuNs: 0 };
          }
        }
        return;
      }

      // Stream ended — flush any remaining buffer
      if (buffer.length > 0) {
        yield* this._flushExecStreamBuffer(buffer);
      }
    } finally {
      reader.releaseLock();
    }
  }

  private *_flushExecStreamBuffer(buffer: string): Generator<ExecStreamChunk> {
    // Check for error event
    const errorIndex = buffer.indexOf("event: error\n");
    if (errorIndex !== -1) {
      const afterEvent = buffer.slice(errorIndex + "event: error\n".length);
      const dataMatch = afterEvent.match(/^data:\s*(.+)/m);
      if (dataMatch) {
        try {
          const parsed = JSON.parse(dataMatch[1]!);
          throw new BoxError(parsed.error ?? "Stream error");
        } catch (e) {
          if (e instanceof BoxError) throw e;
          throw new BoxError("Stream error");
        }
      }
      throw new BoxError("Stream error");
    }

    // Check for exit event
    const exitIndex = buffer.indexOf("event: exit\n");
    if (exitIndex !== -1) {
      if (exitIndex > 0) {
        yield { type: "output", data: buffer.slice(0, exitIndex) };
      }
      const afterEvent = buffer.slice(exitIndex + "event: exit\n".length);
      const dataMatch = afterEvent.match(/^data:\s*(.+)/m);
      if (dataMatch) {
        try {
          const parsed = JSON.parse(dataMatch[1]!);
          yield {
            type: "exit",
            exitCode: parsed.exit_code ?? 0,
            cpuNs: parsed.cpu_ns ?? 0,
          };
        } catch {
          yield { type: "exit", exitCode: 0, cpuNs: 0 };
        }
      }
    } else {
      yield { type: "output", data: buffer };
    }
  }

  // ==================== File Operations ====================

  private static readonly WORKSPACE = "/workspace/home";

  /**
   * Change the in-memory working directory.
   *
   * The cwd is tracked in the SDK, not in the box itself.
   * Every new session starts at `/workspace/home`. Calling `cd` updates the
   * path used by all subsequent file, exec, git, and agent operations.
   *
   * Verifies the target directory exists by running `ls` on the box.
   * Throws if the path does not exist.
   */
  async cd(path: string): Promise<void> {
    let newPath: string;
    if (path.startsWith("/")) {
      newPath = Box._normalizePath(path);
    } else {
      newPath = Box._normalizePath(`${this._cwd}/${path}`);
    }

    const result = await this._request<ExecResult>("POST", `/v2/box/${this.id}/exec`, {
      body: { command: ["ls", newPath] },
    });

    if (result.exit_code !== 0) {
      throw new BoxError(`cd: ${path}: No such file or directory`);
    }

    this._cwd = newPath;
  }

  /** Normalize a path by resolving `.` and `..` segments. */
  private static _normalizePath(p: string): string {
    const parts = p.split("/");
    const resolved: string[] = [];
    for (const part of parts) {
      if (part === "" || part === ".") continue;
      if (part === "..") {
        resolved.pop();
      } else {
        resolved.push(part);
      }
    }
    return "/" + resolved.join("/");
  }

  /**
   * Derive the `folder` parameter (relative to WORKSPACE) from the current working directory.
   * Returns an empty string when cwd is at the workspace root.
   */
  private _getFolder(): string {
    const prefix = Box.WORKSPACE + "/";
    if (this._cwd === Box.WORKSPACE) return "";
    if (this._cwd.startsWith(prefix)) return this._cwd.slice(prefix.length);
    // Outside workspace — pass absolute path
    return this._cwd;
  }

  private _resolvePath(p: string): string {
    if (p.startsWith("/")) return p;
    return `${this._cwd}/${p}`;
  }

  private async _readFile(path: string, encoding?: "base64"): Promise<string> {
    const resolved = this._resolvePath(path);
    let url = `/v2/box/${this.id}/files/read?path=${encodeURIComponent(resolved)}`;
    if (encoding) url += `&encoding=${encodeURIComponent(encoding)}`;
    const data = await this._request<{ content: string }>("GET", url);
    return data.content;
  }

  private async _writeFile(path: string, content: string, encoding?: "base64"): Promise<void> {
    const resolved = this._resolvePath(path);
    await this._request("POST", `/v2/box/${this.id}/files/write`, {
      body: { path: resolved, content, ...(encoding && { encoding }) },
    });
  }

  private async _listFiles(path?: string): Promise<FileEntry[]> {
    let qs = "";
    if (path) {
      const resolved = this._resolvePath(path);
      qs = `?folder=${encodeURIComponent(resolved)}`;
    } else {
      const folder = this._getFolder();
      if (folder) qs = `?folder=${encodeURIComponent(folder)}`;
    }
    const data = await this._request<{ files: FileEntry[] | null }>(
      "GET",
      `/v2/box/${this.id}/files/list${qs}`,
    );
    return data.files ?? [];
  }

  private async _uploadFiles(files: UploadFileEntry[]): Promise<void> {
    const fs = await this._getFs();

    const formData = new FormData();
    for (const file of files) {
      const resolved = this._resolvePath(file.destination);
      const buffer = await fs.readFile(file.path);
      formData.append("paths", resolved);
      formData.append("files", new Blob([buffer]), file.destination);
    }

    const url = `${this._baseUrl}/v2/box/${this.id}/files/upload`;
    this.log(`POST ${url}`);
    const response = await fetch(url, {
      method: "POST",
      headers: this._headers,
      body: formData,
    });

    if (!response.ok) {
      const msg = await parseErrorResponse(response);
      throw new BoxError(msg, response.status);
    }
  }

  private async _downloadFiles(remotePath?: string): Promise<void> {
    const fs = await this._getFs();
    const path = await this._getPath();

    const resolved = remotePath ? this._resolvePath(remotePath) : this._cwd;
    const dest = remotePath
      ? `./${path.basename(resolved)}`
      : this._cwd === Box.WORKSPACE
        ? "./workspace"
        : `./${path.basename(this._cwd)}`;

    const files = await this._listFiles(resolved);
    await fs.mkdir(dest, { recursive: true });

    for (const file of files) {
      if (file.is_dir) continue;
      const url = `${this._baseUrl}/v2/box/${this.id}/files/download?folder=${encodeURIComponent(file.path)}`;
      const response = await fetch(url, { headers: this._headers });
      if (!response.ok) {
        throw new BoxError(`Failed to download ${file.path}`, response.status);
      }
      const buf = Buffer.from(await response.arrayBuffer());
      await fs.writeFile(path.join(dest, file.name), buf);
    }
  }

  // ==================== Lifecycle ====================

  /**
   * Get the current box status.
   */
  async getStatus(): Promise<{ status: string }> {
    return this._request<{ status: string }>("GET", `/v2/box/${this.id}/status`);
  }

  /**
   * Update the AI model configured for this box.
   */
  async configureModel(model: string): Promise<void> {
    await this._request("PUT", `/v2/box/${this.id}/config/model`, {
      body: { model },
    });
    this._model = model;
    this._isAgentConfigured = true;
  }

  /**
   * Update the network access policy for this box.
   */
  async updateNetworkPolicy(policy: NetworkPolicy): Promise<void> {
    await this._request("PUT", `/v2/box/${this.id}/config/network-policy`, {
      body: serializeNetworkPolicy(policy),
    });
    this._networkPolicy = policy;
  }

  /**
   * Read the current init command for a keep-alive box.
   */
  async getInitCommand(): Promise<string> {
    this._requireKeepAlive("Init command");
    const data = await this._request<{ init_command?: string }>(
      "GET",
      `/v2/box/${this.id}/startup`,
    );
    return data.init_command ?? "";
  }

  /**
   * Set or replace the init command for a keep-alive box.
   */
  async setInitCommand(initCommand: string): Promise<void> {
    this._requireKeepAlive("Init command");
    if (!initCommand) {
      throw new BoxError("initCommand is required");
    }
    await this._request("PUT", `/v2/box/${this.id}/startup`, {
      body: { init_command: initCommand },
    });
  }

  /**
   * Delete the init command for a keep-alive box.
   */
  async deleteInitCommand(): Promise<void> {
    this._requireKeepAlive("Init command");
    await this._request("DELETE", `/v2/box/${this.id}/startup`);
  }

  /**
   * Pause the box (release compute, preserve state).
   */
  async pause(): Promise<void> {
    if (this.keepAlive) {
      throw new BoxError("Keep-alive boxes cannot be paused");
    }
    await this._request("POST", `/v2/box/${this.id}/pause`);
  }

  /**
   * Resume a paused box.
   */
  async resume(): Promise<void> {
    await this._request("POST", `/v2/box/${this.id}/resume`);
  }

  /**
   * Delete this box permanently.
   */
  async delete(): Promise<void> {
    await this._request("DELETE", `/v2/box/${this.id}`);
  }

  /**
   * Save workspace state as a snapshot for later restore.
   * Creates the snapshot asynchronously and polls until ready.
   */
  async snapshot(options: { name: string }): Promise<Snapshot> {
    const data = await this._request<Snapshot>("POST", `/v2/box/${this.id}/snapshots`, {
      body: { name: options.name },
    });

    // Poll until snapshot is ready
    const pollInterval = 2000;
    const maxWait = 300000;
    const start = Date.now();
    let snapshot = data;

    while (snapshot.status === "creating" && Date.now() - start < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      const snapshots = await this.listSnapshots();
      const found = snapshots.find((s) => s.id === snapshot.id);
      if (found) snapshot = found;
    }

    if (snapshot.status === "creating") {
      throw new BoxError("Snapshot creation timed out");
    }
    if (snapshot.status === "error") {
      throw new BoxError("Snapshot creation failed");
    }

    return snapshot;
  }

  /**
   * List all snapshots for this box.
   */
  async listSnapshots(): Promise<Snapshot[]> {
    const data = await this._request<{ snapshots: Snapshot[] }>(
      "GET",
      `/v2/box/${this.id}/snapshots`,
    );
    return data.snapshots ?? [];
  }

  /**
   * Delete a snapshot.
   */
  async deleteSnapshot(snapshotId: string): Promise<void> {
    await this._request("DELETE", `/v2/box/${this.id}/snapshots/${snapshotId}`);
  }

  /**
   * Create a new box from a saved snapshot.
   */
  static async fromSnapshot<TProvider = unknown>(
    snapshotId: string,
    config?: BoxConfig,
  ): Promise<Box<TProvider>> {
    const apiKey = config?.apiKey ?? process.env.UPSTASH_BOX_API_KEY;
    if (!apiKey) {
      throw new BoxError(
        "apiKey is required. Pass it in config or set UPSTASH_BOX_API_KEY env var.",
      );
    }
    const baseUrl = (
      config?.baseUrl ??
      process.env.UPSTASH_BOX_BASE_URL ??
      DEFAULT_BASE_URL
    ).replace(/\/$/, "");
    const headers: Record<string, string> = { "X-Box-Api-Key": apiKey };
    const timeout = config?.timeout ?? 600000;
    const debug = config?.debug ?? false;

    const body: Record<string, unknown> = {
      snapshot_id: snapshotId,
    };
    if (config?.name) body.name = config.name;
    if (config?.size) body.size = config.size;
    if (config?.keepAlive) body.keep_alive = true;
    if (config?.initCommand !== undefined) body.init_command = config.initCommand;
    if (config?.agent) {
      body.model = config.agent.model;
      body.agent = resolveAgentHarness(config.agent);
      body.agent_api_key = config.agent.apiKey;
    }
    if (config?.runtime) body.runtime = config.runtime;
    if (config?.git?.token) body.github_token = config.git.token;
    if (config?.env) body.env_vars = config.env;
    if (config?.attachHeaders) body.attach_headers = config.attachHeaders;
    if (config?.networkPolicy) body.network_policy = serializeNetworkPolicy(config.networkPolicy);

    const response = await fetch(`${baseUrl}/v2/box/from-snapshot`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const msg = await parseErrorResponse(response);
      throw new BoxError(msg, response.status);
    }

    let data = (await response.json()) as BoxData;

    // Poll until ready
    const pollInterval = 2000;
    const maxWait = 300000;
    const start = Date.now();

    while (data.status === "creating" && Date.now() - start < maxWait) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      const pollResponse = await fetch(`${baseUrl}/v2/box/${data.id}`, { headers });
      if (pollResponse.ok) {
        data = (await pollResponse.json()) as BoxData;
      }
    }

    if (data.status === "creating") {
      throw new BoxError("Box creation from snapshot timed out");
    }
    if (data.status === "error") {
      throw new BoxError("Box creation from snapshot failed");
    }

    return new Box(data, {
      baseUrl,
      headers,
      timeout,
      debug,
      gitToken: config?.git?.token,
      isAgentConfigured: Boolean(data.model),
    });
  }

  /**
   * Get structured logs for this box.
   */
  async logs(options?: { offset?: number; limit?: number }): Promise<LogEntry[]> {
    const params = new URLSearchParams();
    if (options?.offset) params.set("offset", String(options.offset));
    if (options?.limit) params.set("limit", String(options.limit));
    const qs = params.toString() ? `?${params.toString()}` : "";
    const data = await this._request<{ logs: LogEntry[] }>("GET", `/v2/box/${this.id}/logs${qs}`);
    return data.logs;
  }

  /**
   * List all runs for this box, newest first.
   */
  async listRuns(): Promise<BoxRunData[]> {
    const data = await this._request<{ runs: BoxRunData[] }>("GET", `/v2/box/${this.id}/runs`);
    return data.runs;
  }

  // ==================== Internal ====================

  private log(...args: unknown[]) {
    if (this._debug) console.log("[Box]", ...args);
  }

  private _requireKeepAlive(feature: string): void {
    if (!this.keepAlive) {
      throw new BoxError(`${feature} is only available for keep-alive boxes`);
    }
  }

  /** @internal */
  async _request<T>(
    method: string,
    path: string,
    options: { body?: unknown; timeout?: number } = {},
  ): Promise<T> {
    const url = `${this._baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout ?? this._timeout);

    try {
      const headers: Record<string, string> = { ...this._headers };
      let body: string | undefined;

      if (options.body) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(options.body);
      }

      this.log(`${method} ${url}`);
      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });

      this.log(`Response status: ${response.status}`);

      if (!response.ok) {
        const msg = await parseErrorResponse(response);
        throw new BoxError(msg, response.status);
      }

      const text = await response.text();
      if (!text) return {} as T;
      return JSON.parse(text) as T;
    } catch (error) {
      if (error instanceof BoxError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new BoxError("Request timeout");
      }
      throw new BoxError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ==================== Schedule (private, exposed via this.schedule) ====================

  private async _scheduleExec(options: ExecScheduleOptions): Promise<Schedule> {
    const body: Record<string, unknown> = {
      type: "exec",
      cron: options.cron,
      command: options.command,
      folder: options.folder ? this._resolvePath(options.folder) : this._cwd,
    };
    if (options.webhookUrl) body.webhook_url = options.webhookUrl;
    if (options.webhookHeaders) body.webhook_headers = options.webhookHeaders;
    return this._request<Schedule>("POST", `/v2/box/${this.id}/schedules`, { body });
  }

  private async _scheduleAgent(options: AgentScheduleOptions<TProvider>): Promise<Schedule> {
    const body: Record<string, unknown> = {
      type: "prompt",
      cron: options.cron,
      prompt: options.prompt,
      folder: options.folder ? this._resolvePath(options.folder) : this._cwd,
    };
    if (options.model) body.model = options.model;
    if (options.options) body.agent_options = toBackendAgentOptions(this._agent, options.options);
    if (options.timeout) body.timeout = options.timeout;
    if (options.webhookUrl) body.webhook_url = options.webhookUrl;
    if (options.webhookHeaders) body.webhook_headers = options.webhookHeaders;
    return this._request<Schedule>("POST", `/v2/box/${this.id}/schedules`, { body });
  }

  private async _scheduleList(): Promise<Schedule[]> {
    return this._request<Schedule[]>("GET", `/v2/box/${this.id}/schedules`);
  }

  private async _scheduleGet(id: string): Promise<Schedule> {
    return this._request<Schedule>("GET", `/v2/box/${this.id}/schedules/${id}`);
  }

  private async _schedulePause(id: string): Promise<void> {
    await this._request("POST", `/v2/box/${this.id}/schedules/${id}/pause`);
  }

  private async _scheduleResume(id: string): Promise<void> {
    await this._request("POST", `/v2/box/${this.id}/schedules/${id}/resume`);
  }

  private async _scheduleDelete(id: string): Promise<void> {
    await this._request("DELETE", `/v2/box/${this.id}/schedules/${id}`);
  }

  // ==================== Git (private, exposed via this.git) ====================

  private async _gitClone(options: GitCloneOptions): Promise<void> {
    const folder = this._getFolder();
    await this._request("POST", `/v2/box/${this.id}/git/clone`, {
      body: {
        repo: options.repo,
        branch: options.branch,
        github_token: this._gitToken,
        ...(folder ? { folder } : {}),
      },
    });
  }

  private async _gitDiff(): Promise<string> {
    const folder = this._getFolder();
    const qs = folder ? `?folder=${encodeURIComponent(folder)}` : "";
    const data = await this._request<{ diff: string }>("GET", `/v2/box/${this.id}/git/diff${qs}`);
    return data.diff;
  }

  private async _gitStatus(): Promise<string> {
    const folder = this._getFolder();
    const qs = folder ? `?folder=${encodeURIComponent(folder)}` : "";
    const data = await this._request<{ status: string }>(
      "GET",
      `/v2/box/${this.id}/git/status${qs}`,
    );
    return data.status;
  }

  private async _gitCommit(options: GitCommitOptions): Promise<GitCommitResult> {
    const folder = this._getFolder();
    return this._request<GitCommitResult>("POST", `/v2/box/${this.id}/git/commit`, {
      body: {
        message: options.message,
        author_name: options.authorName,
        author_email: options.authorEmail,
        ...(folder ? { folder } : {}),
      },
    });
  }

  private async _gitUpdateConfig(options: GitConfigUpdateOptions): Promise<GitConfig> {
    if (!options.userName && !options.userEmail) {
      throw new BoxError("At least one of userName or userEmail is required");
    }

    return this._request<GitConfig>("PUT", `/v2/box/${this.id}/git-config`, {
      body: {
        git_user_name: options.userName,
        git_user_email: options.userEmail,
      },
    });
  }

  private async _gitPush(options?: { branch?: string }): Promise<void> {
    const folder = this._getFolder();
    await this._request("POST", `/v2/box/${this.id}/git/push`, {
      body: { branch: options?.branch, ...(folder ? { folder } : {}) },
    });
  }

  private async _gitCreatePR(options: GitPROptions): Promise<PullRequest> {
    const folder = this._getFolder();
    return this._request<PullRequest>("POST", `/v2/box/${this.id}/git/create-pr`, {
      body: {
        title: options.title,
        body: options.body,
        base: options.base,
        ...(folder ? { folder } : {}),
      },
    });
  }

  private async _gitExec(options: GitExecOptions): Promise<GitExecResult> {
    const folder = this._getFolder();
    return this._request<GitExecResult>("POST", `/v2/box/${this.id}/git/exec`, {
      body: { args: options.args, ...(folder ? { folder } : {}) },
    });
  }

  private async _gitCheckout(options: GitCheckoutOptions): Promise<void> {
    const folder = this._getFolder();
    await this._request("POST", `/v2/box/${this.id}/git/checkout`, {
      body: { branch: options.branch, ...(folder ? { folder } : {}) },
    });
  }

  // ==================== Skills ====================

  private async _skillAdd(skillId: string): Promise<void> {
    await this._request("POST", `/v2/box/${this.id}/config/skills`, {
      body: { skill_id: skillId },
    });
  }

  private async _skillRemove(skillId: string): Promise<void> {
    // skill_id format: owner/repo/skill-name
    await this._request("DELETE", `/v2/box/${this.id}/config/skills/${skillId}`);
  }

  private async _skillList(): Promise<string[]> {
    const data = await this._request<BoxData>("GET", `/v2/box/${this.id}`);
    return data.enabled_skills ?? [];
  }

  // ==================== Public URLs ====================

  async getPublicURL(
    port: number,
    options?: { bearerToken?: boolean; basicAuth?: boolean },
  ): Promise<PublicURL> {
    return this._request<PublicURL>("POST", `/v2/box/${this.id}/preview`, {
      body: {
        port,
        ...(options?.bearerToken !== undefined && { bearer_token: options.bearerToken }),
        ...(options?.basicAuth !== undefined && { basic_auth: options.basicAuth }),
      },
    });
  }

  async listPublicURLs(): Promise<{ publicURLs: PublicURL[] }> {
    const data = await this._request<{ previews: PublicURL[] }>(
      "GET",
      `/v2/box/${this.id}/preview`,
    );
    return { publicURLs: data.previews };
  }

  async deletePublicURL(port: number): Promise<void> {
    await this._request("DELETE", `/v2/box/${this.id}/preview/${port}`);
  }

  /** @deprecated Use `getPublicURL` instead. */
  async getPreviewUrl(
    port: number,
    options?: { bearerToken?: boolean; basicAuth?: boolean },
  ): Promise<Preview> {
    return this.getPublicURL(port, options);
  }

  /** @deprecated Use `listPublicURLs` instead. */
  async listPreviews(): Promise<{ previews: Preview[] }> {
    const data = await this.listPublicURLs();
    return { previews: data.publicURLs };
  }

  /** @deprecated Use `deletePublicURL` instead. */
  async deletePreview(port: number): Promise<void> {
    await this.deletePublicURL(port);
  }
}

// ==================== Ephemeral Box ====================

/**
 * A lightweight, short-lived box that supports only exec and file operations.
 *
 * Ephemeral boxes are created synchronously (no polling) and auto-delete after
 * the configured TTL. They do not support agent, git, or snapshot
 * operations.
 *
 * @example
 * ```ts
 * const box = await EphemeralBox.create({ runtime: "node", ttl: 3600 });
 * const run = await box.exec.command("echo hello");
 * console.log(run.result); // "hello"
 * await box.delete();
 * ```
 */
export class EphemeralBox {
  readonly id: string;

  /** Unix timestamp (seconds) when this box will be auto-deleted. */
  readonly expiresAt: number;

  /** File operations namespace */
  readonly files: {
    /**
     * Read a file from the box.
     *
     * @example
     * ```ts
     * const content = await box.files.read("index.js");
     * const b64 = await box.files.read("image.png", { encoding: "base64" });
     * ```
     */
    read: (path: string, options?: { encoding?: "base64" }) => Promise<string>;
    /**
     * Write a file to the box.
     *
     * @example
     * ```ts
     * await box.files.write({ path: "hello.txt", content: "Hello!" });
     * ```
     */
    write: (options: { path: string; content: string; encoding?: "base64" }) => Promise<void>;
    /**
     * List files in a directory.
     *
     * @example
     * ```ts
     * const files = await box.files.list("src");
     * ```
     */
    list: (path?: string) => Promise<FileEntry[]>;
    /**
     * Upload local files to the box.
     *
     * @example
     * ```ts
     * await box.files.upload([{ path: "./local.txt", destination: "remote.txt" }]);
     * ```
     */
    upload: (files: UploadFileEntry[]) => Promise<void>;
    /**
     * Download files from the box to the local filesystem.
     *
     * @example
     * ```ts
     * await box.files.download({ folder: "src" });
     * ```
     */
    download: (options?: { folder?: string }) => Promise<void>;
  };

  /** Execution namespace — shell commands and inline code */
  readonly exec: {
    command: (command: string) => Promise<Run<string>>;
    code: (options: CodeExecutionOptions) => Promise<Run<string>>;
    stream: (command: string) => Promise<StreamRun<string, ExecStreamChunk>>;
    streamCode: (options: CodeExecutionOptions) => Promise<StreamRun<string, ExecStreamChunk>>;
  };

  /** Schedule operations namespace */
  readonly schedule: Box["schedule"];

  private _box: Box;

  /** @internal */
  constructor(box: Box, expiresAt: number) {
    this._box = box;
    this.id = box.id;
    this.expiresAt = expiresAt;
    this.exec = box.exec;
    this.files = box.files;
    this.schedule = box.schedule;
  }

  /**
   * The current working directory tracked in the SDK.
   * Every new session starts at `/workspace/home`.
   */
  /** Current network access policy for this box. */
  get networkPolicy(): NetworkPolicy {
    return this._box.networkPolicy;
  }

  get cwd(): string {
    return this._box.cwd;
  }

  /**
   * Change the in-memory working directory.
   *
   * The cwd is tracked in the SDK, not in the box itself.
   * Verifies the target directory exists by running `ls` on the box.
   * Throws if the path does not exist.
   */
  async cd(path: string): Promise<void> {
    return this._box.cd(path);
  }

  /**
   * Get the current box status.
   */
  async getStatus(): Promise<{ status: string }> {
    return this._box.getStatus();
  }

  /**
   * Delete this ephemeral box before its TTL expires.
   */
  async delete(): Promise<void> {
    return this._box.delete();
  }

  /**
   * Save workspace state as a snapshot for later restore.
   * Creates the snapshot asynchronously and polls until ready.
   */
  async snapshot(options: { name: string }): Promise<Snapshot> {
    return this._box.snapshot(options);
  }

  /**
   * List all snapshots for this box.
   */
  async listSnapshots(): Promise<Snapshot[]> {
    return this._box.listSnapshots();
  }

  /**
   * Delete a snapshot.
   */
  async deleteSnapshot(snapshotId: string): Promise<void> {
    return this._box.deleteSnapshot(snapshotId);
  }

  /**
   * Create a new ephemeral box.
   *
   * Ephemeral boxes are ready immediately — no polling required.
   * They auto-delete after the configured TTL (default: 3 days).
   *
   * @example
   * ```ts
   * // Node.js runtime with 1 hour TTL
   * const box = await EphemeralBox.create({ runtime: "node", ttl: 3600 });
   *
   * // Python runtime with 30 min TTL
   * const box = await EphemeralBox.create({ runtime: "python", ttl: 1800 });
   *
   * // Default runtime and max TTL
   * const box = await EphemeralBox.create();
   * ```
   */
  static async create(config?: EphemeralBoxConfig): Promise<EphemeralBox> {
    const apiKey = config?.apiKey ?? process.env.UPSTASH_BOX_API_KEY;
    if (!apiKey) {
      throw new BoxError(
        "apiKey is required. Pass it in config or set UPSTASH_BOX_API_KEY env var.",
      );
    }

    const baseUrl = (
      config?.baseUrl ??
      process.env.UPSTASH_BOX_BASE_URL ??
      DEFAULT_BASE_URL
    ).replace(/\/$/, "");
    const headers: Record<string, string> = {
      "X-Box-Api-Key": apiKey,
    };
    const timeout = config?.timeout ?? 600000;
    const debug = config?.debug ?? false;

    const body: Record<string, unknown> = { ephemeral: true };
    if (config?.name) body.name = config.name;
    if (config?.size) body.size = config.size;
    if (config?.ttl !== undefined) body.ttl = config.ttl;
    if (config?.runtime) body.runtime = config.runtime;
    if (config?.env) body.env_vars = config.env;
    if (config?.attachHeaders) body.attach_headers = config.attachHeaders;
    if (config?.networkPolicy) body.network_policy = serializeNetworkPolicy(config.networkPolicy);

    const response = await fetch(`${baseUrl}/v2/box`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const msg = await parseErrorResponse(response);
      throw new BoxError(msg, response.status);
    }

    const data = (await response.json()) as EphemeralBoxData;

    const box = new Box(data, {
      baseUrl,
      headers,
      timeout,
      debug,
    });

    return new EphemeralBox(box, data.expires_at);
  }

  /**
   * Create an ephemeral box from a snapshot.
   *
   * Ephemeral boxes are ready immediately — no polling required.
   * They auto-delete after the configured TTL (default: 3 days).
   *
   * @example
   * ```ts
   * const box = await EphemeralBox.fromSnapshot("snap-abc123", { ttl: 3600 });
   * ```
   */
  static async fromSnapshot(
    snapshotId: string,
    config?: EphemeralBoxConfig,
  ): Promise<EphemeralBox> {
    const apiKey = config?.apiKey ?? process.env.UPSTASH_BOX_API_KEY;
    if (!apiKey) {
      throw new BoxError(
        "apiKey is required. Pass it in config or set UPSTASH_BOX_API_KEY env var.",
      );
    }

    const baseUrl = (
      config?.baseUrl ??
      process.env.UPSTASH_BOX_BASE_URL ??
      DEFAULT_BASE_URL
    ).replace(/\/$/, "");
    const headers: Record<string, string> = {
      "X-Box-Api-Key": apiKey,
    };
    const timeout = config?.timeout ?? 600000;
    const debug = config?.debug ?? false;

    const body: Record<string, unknown> = {
      snapshot_id: snapshotId,
      ephemeral: true,
    };
    if (config?.name) body.name = config.name;
    if (config?.size) body.size = config.size;
    if (config?.ttl !== undefined) body.ttl = config.ttl;
    if (config?.runtime) body.runtime = config.runtime;
    if (config?.env) body.env_vars = config.env;
    if (config?.attachHeaders) body.attach_headers = config.attachHeaders;
    if (config?.networkPolicy) body.network_policy = serializeNetworkPolicy(config.networkPolicy);

    const response = await fetch(`${baseUrl}/v2/box/from-snapshot`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const msg = await parseErrorResponse(response);
      throw new BoxError(msg, response.status);
    }

    const data = (await response.json()) as EphemeralBoxData;

    const box = new Box(data, {
      baseUrl,
      headers,
      timeout,
      debug,
    });

    return new EphemeralBox(box, data.expires_at);
  }

  /**
   * Get an existing ephemeral box by name
   */
  static getByName = Box.get;

  /**
   * Delete specific boxes by ID.
   */
  static delete = Box.delete;
}

// ==================== Helpers ====================

/** @internal — Convert a Zod schema to a JSON Schema object for the API's json_schema parameter */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toJsonSchema(schema: ZodType<any>): Record<string, unknown> | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = zodToJsonSchemaLib(schema as any);
    // Strip the $schema meta key — the API only needs the schema body
    const { $schema: _, ...jsonSchema } = result as Record<string, unknown>;
    return jsonSchema;
  } catch {
    // Not a Zod schema or conversion failed
  }
  return null;
}

/** Serialize a NetworkPolicy into the API wire format. */
function serializeNetworkPolicy(policy: NetworkPolicy): Record<string, unknown> {
  if (policy.mode === "custom") {
    return {
      mode: policy.mode,
      allowed_domains: policy.allowedDomains,
      allowed_cidrs: policy.allowedCidrs,
      denied_cidrs: policy.deniedCidrs,
    };
  }
  return { mode: policy.mode };
}

/** Deserialize the API wire format into a NetworkPolicy. */
function deserializeNetworkPolicy(raw: BoxData["network_policy"]): NetworkPolicy {
  if (!raw) {
    return { mode: "allow-all" };
  }
  if (raw.mode === "custom") {
    return {
      mode: "custom",
      allowedDomains: raw.allowed_domains,
      allowedCidrs: raw.allowed_cidrs,
      deniedCidrs: raw.denied_cidrs,
    };
  }
  return { mode: raw.mode };
}

/** Check whether PromptFiles are local file paths (string[]) or base64 data objects. */
function isFilePaths(files: PromptFiles): files is string[] {
  return typeof files[0] === "string";
}

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".json": "application/json",
  ".xml": "application/xml",
  ".html": "text/html",
  ".md": "text/markdown",
  ".ts": "text/plain",
  ".js": "text/plain",
  ".py": "text/plain",
};

/**
 * Build a multipart FormData body from run options + local file paths.
 * All options are sent as form fields; files as binary parts.
 */
async function buildMultipartBody(
  requestBody: Record<string, unknown>,
  filePaths: string[],
): Promise<FormData> {
  const [fs, path] = await Promise.all([import("node:fs/promises"), import("node:path")]);

  const formData = new FormData();

  // Add all scalar fields
  for (const [key, value] of Object.entries(requestBody)) {
    if (value === undefined) continue;
    if (typeof value === "string") {
      formData.append(key, value);
    } else {
      formData.append(key, JSON.stringify(value));
    }
  }

  // Add files as binary parts
  for (const filePath of filePaths) {
    const buffer = await fs.readFile(filePath);
    const filename = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = MIME_TYPES[ext] ?? "application/octet-stream";
    formData.append("files", new Blob([buffer], { type: mimeType }), filename);
  }

  return formData;
}

/**
 * Build the fetch body + headers for a run request.
 * - file paths → multipart FormData
 * - base64 objects → JSON with `files` array
 * - no files → plain JSON
 */
async function buildRunRequest(
  baseHeaders: Record<string, string>,
  requestBody: Record<string, unknown>,
  files?: PromptFiles,
): Promise<{ body: string | FormData; headers: Record<string, string> }> {
  if (files?.length) {
    if (isFilePaths(files)) {
      return {
        body: await buildMultipartBody(requestBody, files),
        headers: { ...baseHeaders },
      };
    }
    requestBody.files = files.map((f) => ({
      data: f.data,
      media_type: f.mediaType,
      filename: f.filename,
    }));
  }
  return {
    body: JSON.stringify(requestBody),
    headers: { ...baseHeaders, "Content-Type": "application/json" },
  };
}

/** @internal */
export async function parseErrorResponse(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as ErrorResponse;
    return data.error ?? `Request failed with status ${response.status}`;
  } catch {
    return `Request failed with status ${response.status}`;
  }
}
