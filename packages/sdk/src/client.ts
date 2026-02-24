import { readFile as fsReadFile, writeFile as fsWriteFile, mkdir } from "node:fs/promises";
import { randomUUID, createHmac } from "node:crypto";
import { basename, join } from "node:path";

import type {
  BoxConfig,
  BoxData,
  BoxGetOptions,
  BoxRunData,
  ListOptions,
  RunOptions,
  StreamOptions,
  RunResult,
  RunStatus,
  RunCost,
  RunLog,
  SchemaLike,
  WebhookConfig,
  WebhookPayload,
  ExecResult,
  ErrorResponse,
  FileEntry,
  GitCloneOptions,
  GitPROptions,
  GitCommitResult,
  PullRequest,
  LogEntry,
  UploadFileEntry,
  Snapshot,
} from "./types.js";
import { appendFileSync } from "node:fs";

const DEFAULT_BASE_URL = "https://us-east-1.box.upstash.com"

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

/**
 * A run represents a single agent or shell execution.
 * Returned by box.agent.run() and box.exec().
 */
export class Run<T = string> {
  readonly type: "agent" | "shell";

  /** @internal */
  _id: string;
  /** @internal */
  _result: T | null = null;
  /** @internal */
  _status: RunStatus = "running";
  /** @internal */
  _inputTokens = 0;
  /** @internal */
  _outputTokens = 0;
  /** @internal */
  _computeMs = 0;
  /** @internal */
  _box: Box;
  /** @internal */
  _abortController?: AbortController;
  /** @internal */
  _startTime: number;

  /** The run ID. Initially a local UUID, replaced by backend run_id from run_start event. */
  get id(): string {
    return this._id;
  }

  /** @internal */
  constructor(box: Box, type: "agent" | "shell", id?: string) {
    this._id = id ?? randomUUID();
    this.type = type;
    this._box = box;
    this._startTime = Date.now();
  }

  /**
   * Get the current run status. Polls the backend for the latest status if the run may still be active.
   */
  async status(): Promise<RunStatus> {
    if (["completed", "failed", "cancelled"].includes(this._status)) {
      return this._status;
    }
    try {
      const data = await this._box._request<{ status: RunStatus }>(
        "GET",
        `/v2/box/${this._box.id}/runs/${this._id}`,
      );
      this._status = data.status;
    } catch {
      // Fallback to local status if backend call fails
    }
    return this._status;
  }

  /**
   * Get the run result. Returns the typed output when responseSchema was provided.
   */
  async result(): Promise<T> {
    if (this._result === null) {
      return "" as T;
    }
    return this._result;
  }

  /**
   * Get token usage and cost information. Fetches from backend when available.
   */
  async cost(): Promise<RunCost> {
    try {
      const data = await this._box._request<{
        input_tokens?: number;
        output_tokens?: number;
        duration_ms?: number;
        cost_usd?: number;
      }>("GET", `/v2/box/${this._box.id}/runs/${this._id}`);
      return {
        tokens: (data.input_tokens ?? 0) + (data.output_tokens ?? 0),
        computeMs: data.duration_ms ?? 0,
        totalUsd: data.cost_usd ?? 0,
      };
    } catch {
      return {
        tokens: this._inputTokens + this._outputTokens,
        computeMs: this._computeMs || Date.now() - this._startTime,
        totalUsd: 0,
      };
    }
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
}

/**
 * A sandboxed AI coding environment.
 *
 * @example
 * ```ts
 * import { Box, Runtime, ClaudeCode } from "@upstash/box";
 *
 * const box = await Box.create({
 *   runtime: Runtime.Node,
 *   agent: { model: ClaudeCode.Sonnet_4_5, apiKey: process.env.CLAUDE_KEY! },
 * });
 *
 * // Non-streaming
 * const run = await box.agent.run({ prompt: "Fix the bug in auth.ts" });
 * console.log(await run.result());
 *
 * // Streaming
 * for await (const chunk of box.agent.stream({ prompt: "Add tests" })) {
 *   process.stdout.write(chunk);
 * }
 *
 * await box.delete();
 * ```
 */
export class Box {
  readonly id: string;

  /** Agent operations namespace */
  readonly agent: {
    run<T>(options: RunOptions<T> & { responseSchema: SchemaLike<T> }): Promise<Run<T>>;
    run(options: RunOptions): Promise<Run<string>>;
    stream(options: StreamOptions): AsyncGenerator<string>;
  };

  /** File operations namespace */
  readonly files: {
    read: (path: string) => Promise<string>;
    write: (options: { path: string; content: string }) => Promise<void>;
    list: (path?: string) => Promise<FileEntry[]>;
    upload: (files: UploadFileEntry[]) => Promise<void>;
    download: (options?: { path?: string }) => Promise<void>;
  };

  /** Git operations namespace */
  readonly git: {
    clone: (options: GitCloneOptions) => Promise<void>;
    diff: () => Promise<string>;
    status: () => Promise<string>;
    commit: (options: { message: string }) => Promise<GitCommitResult>;
    push: (options?: { branch?: string }) => Promise<void>;
    createPR: (options: GitPROptions) => Promise<PullRequest>;
  };

  private _baseUrl: string;
  private _headers: Record<string, string>;
  private _timeout: number;
  private _debug: boolean;
  private _gitToken?: string;
  private _isAgentConfigured: boolean;

  private constructor(
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
            'No agent configured. Pass an `agent` option to Box.create() to use box.agent.run().\n\nExample:\n  await Box.create({ agent: { model: ClaudeCode.Sonnet_4_5, apiKey: "sk-..." } })',
          );
        }
        return self._run(options);
      },
      stream(options: StreamOptions): AsyncGenerator<string> {
        if (!self._isAgentConfigured) {
          throw new BoxError(
            'No agent configured. Pass an `agent` option to Box.create() to use box.agent.stream().\n\nExample:\n  await Box.create({ agent: { model: ClaudeCode.Sonnet_4_5, apiKey: "sk-..." } })',
          );
        }
        return self._stream(options);
      },
    } as this["agent"];

    this.files = {
      read: (path) => this._readFile(path),
      write: (opts) => this._writeFile(opts.path, opts.content),
      list: (path) => this._listFiles(path),
      upload: (files) => this._uploadFiles(files),
      download: (opts) => this._downloadFiles(opts?.path),
    };

    this.git = {
      clone: (options) => this._gitClone(options),
      diff: () => this._gitDiff(),
      status: () => this._gitStatus(),
      commit: (options) => this._gitCommit(options),
      push: (options) => this._gitPush(options),
      createPR: (options) => this._gitCreatePR(options),
    };
  }

  /**
   * Create a new sandboxed box.
   */
  static async create(config: BoxConfig): Promise<Box> {
    const apiKey = config.apiKey ?? process.env.UPSTASH_BOX_API_KEY;
    if (!apiKey) {
      throw new BoxError(
        "apiKey is required. Pass it in config or set UPSTASH_BOX_API_KEY env var.",
      );
    }
    if (config.agent && !config.agent.model) {
      throw new BoxError("agent.model is required when agent is configured");
    }
    if (config.agent && !config.agent.apiKey) {
      throw new BoxError("Agent API key is undefined. Please provide a valid provider API key.");
    }

    const baseUrl = (
      config.baseUrl ??
      process.env.UPSTASH_BOX_BASE_URL ??
      DEFAULT_BASE_URL
    ).replace(/\/$/, "");
    const headers: Record<string, string> = {
      "X-Box-Api-Key": apiKey,
    };
    const timeout = config.timeout ?? 600000;
    const debug = config.debug ?? false;

    const body: Record<string, unknown> = {};
    if (config.agent) {
      body.model = config.agent.model;
      body.agent_api_key = config.agent.apiKey!;
    }
    if (config.runtime) body.runtime = config.runtime;
    if (config.git?.token) body.github_token = config.git.token;
    if (config.env) body.env_vars = config.env;
    if (config.skills?.length) body.skills = config.skills;
    if (config.mcpServers?.length) {
      body.mcp_servers = config.mcpServers.map((s) => ({
        name: s.name,
        source: s.source,
        package_or_url: s.packageOrUrl,
        headers: s.headers,
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
      gitToken: config.git?.token,
      isAgentConfigured: Boolean(config.agent),
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
   * Get an existing box by ID.
   */
  static async get(boxId: string, options?: BoxGetOptions): Promise<Box> {
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

  // ==================== Run ====================

  /** @internal */
  async _run<T>(options: RunOptions<T>): Promise<Run<T | string>> {
    if (!options.prompt) throw new BoxError("prompt is required");

    // Webhook mode: fire-and-forget — run in background, POST result to webhook URL
    if (options.webhook) {
      const run = new Run<T | string>(this, "agent");
      const webhook = options.webhook;
      const boxId = this.id;

      // Run in background, don't await
      this._runWithRetries(options).then(
        async (completedRun) => {
          const cost = await completedRun.cost();
          const payload: WebhookPayload = {
            runId: completedRun.id,
            boxId,
            status: "completed",
            result: completedRun._result as string | null,
            cost,
            completedAt: new Date().toISOString(),
          };
          await sendWebhook(webhook, payload);
        },
        async (err) => {
          const payload: WebhookPayload = {
            runId: run.id,
            boxId,
            status: "failed",
            result: null,
            cost: { tokens: 0, computeMs: 0, totalUsd: 0 },
            completedAt: new Date().toISOString(),
            error: err instanceof Error ? err.message : String(err),
          };
          await sendWebhook(webhook, payload);
        },
      );

      return run;
    }

    return this._runWithRetries(options);
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
    // Build prompt with schema instructions if needed
    let prompt = options.prompt;
    if (options.responseSchema) {
      const shape = extractSchemaShape(options.responseSchema);
      prompt += `\n\nRespond with ONLY a valid JSON object. No markdown, no code blocks, no explanation — just raw JSON. Use proper JSON types: numbers must be numbers (not strings), arrays must be arrays (not strings).`;
      if (shape) {
        prompt += `\n\nThe JSON must use these exact field names and types:\n${shape}`;
      }
    }

    const run = new Run<T | string>(this, "agent");
    const abortController = new AbortController();
    run._abortController = abortController;

    if (options.timeout) {
      setTimeout(() => abortController.abort(), options.timeout);
    }

    const url = `${this._baseUrl}/v2/box/${this.id}/run/stream`;
    const response = await fetch(url, {
      method: "POST",
      headers: { ...this._headers, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
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
            if (parsed.run_id) run._id = parsed.run_id;
            break;
          }
          case "text": {
            const text = parsed.text ?? "";
            if (text) {
              rawOutput += text;
              options.onStream?.(text);
            }
            break;
          }
          case "tool": {
            options.onToolUse?.({ name: parsed.name, input: parsed.input });
            break;
          }
          case "done": {
            run._inputTokens = parsed.input_tokens ?? 0;
            run._outputTokens = parsed.output_tokens ?? 0;
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
        run._status = "cancelled";
        run._computeMs = Date.now() - run._startTime;
        throw new BoxError("Run timed out");
      }
      throw e;
    }

    // Parse structured output if schema provided
    let output: T | string = rawOutput.trim();
    if (options.responseSchema) {
      let jsonStr = (output as string).trim();
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch?.[1]) jsonStr = jsonMatch[1].trim();

      try {
        const parsed = JSON.parse(jsonStr);
        output = options.responseSchema.parse(parsed);
      } catch (e) {
        throw new BoxError(
          `Failed to parse structured output: ${e instanceof Error ? e.message : e}\n\nRaw output: ${(output as string).slice(0, 500)}`,
        );
      }
    }

    run._result = output;
    run._status = "completed";
    run._computeMs = Date.now() - run._startTime;

    return run;
  }

  /** @internal */
  async *_stream(options: StreamOptions): AsyncGenerator<string> {
    if (!options.prompt) throw new BoxError("prompt is required");

    const abortController = new AbortController();
    if (options.timeout) {
      setTimeout(() => abortController.abort(), options.timeout);
    }

    const url = `${this._baseUrl}/v2/box/${this.id}/run/stream`;
    const response = await fetch(url, {
      method: "POST",
      headers: { ...this._headers, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: options.prompt }),
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

          // print lines to a file for debugging
          appendFileSync("./debug-stream.txt", line + "\n");

          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            eventData = line.slice(6);
          } else if ((line === "" || line.trim() === "") && eventType && eventData) {
            const text = this._processStreamEvent(eventType, eventData, options);
            if (text !== null) yield text;
            eventType = "";
            eventData = "";
          }
        }

        if (eventType && eventData && (buffer === "" || buffer.trim() === "")) {
          const text = this._processStreamEvent(eventType, eventData, options);
          if (text !== null) yield text;
          eventType = "";
          eventData = "";
        }
      }

      if (eventType && eventData) {
        const text = this._processStreamEvent(eventType, eventData, options);
        if (text !== null) yield text;
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        throw new BoxError("Stream timed out");
      }
      throw e;
    }
  }

  private _processStreamEvent(type: string, data: string, options: StreamOptions): string | null {
    try {
      const parsed = JSON.parse(data);
      switch (type) {
        case "text": {
          const text = parsed.text ?? "";
          return text || null;
        }
        case "tool": {
          options.onToolUse?.({ name: parsed.name, input: parsed.input });
          return null;
        }
        case "error":
          throw new BoxError(parsed.error ?? "Stream error");
        default:
          return null;
      }
    } catch (e) {
      if (e instanceof BoxError) throw e;
      return null;
    }
  }

  // ==================== Shell ====================

  /**
   * Execute an OS-level command in the box.
   *
   * @example
   * ```ts
   * const run = await box.exec("node /work/index.js");
   * console.log(await run.result());
   * console.log(await run.status()); // "completed"
   * ```
   */
  async exec(command: string): Promise<Run<string>> {
    const start = Date.now();
    const result = await this._request<ExecResult>("POST", `/v2/box/${this.id}/exec`, {
      body: { command: ["sh", "-c", command] },
    });

    const run = new Run<string>(this, "shell");
    run._result = result.error ? result.error : result.output;
    run._status = result.exit_code === 0 ? "completed" : "failed";
    run._computeMs = Date.now() - start;
    return run;
  }

  // ==================== File Operations ====================

  private static readonly WORKSPACE = "/workspace/home";

  private _resolvePath(p: string): string {
    if (p.startsWith("/")) return p;
    return `${Box.WORKSPACE}/${p}`;
  }

  private async _readFile(path: string): Promise<string> {
    const resolved = this._resolvePath(path);
    const data = await this._request<{ content: string }>(
      "GET",
      `/v2/box/${this.id}/files/read?path=${encodeURIComponent(resolved)}`,
    );
    return data.content;
  }

  private async _writeFile(path: string, content: string): Promise<void> {
    const resolved = this._resolvePath(path);
    await this._request("POST", `/v2/box/${this.id}/files/write`, {
      body: { path: resolved, content },
    });
  }

  private async _listFiles(path?: string): Promise<FileEntry[]> {
    const resolved = path ? this._resolvePath(path) : "";
    const p = resolved ? `?path=${encodeURIComponent(resolved)}` : "";
    const data = await this._request<{ files: FileEntry[] }>(
      "GET",
      `/v2/box/${this.id}/files/list${p}`,
    );
    return data.files;
  }

  private async _uploadFiles(files: UploadFileEntry[]): Promise<void> {
    for (const file of files) {
      const content = await fsReadFile(file.path);
      const base64 = content.toString("base64");
      const resolved = this._resolvePath(file.destination);
      await this._request("POST", `/v2/box/${this.id}/files/write`, {
        body: { path: resolved, content: base64, encoding: "base64" },
      });
    }
  }

  private async _downloadFiles(remotePath?: string): Promise<void> {
    const resolved = remotePath ? this._resolvePath(remotePath) : Box.WORKSPACE;
    const dest = remotePath ? `./${basename(resolved)}` : "./workspace";

    const files = await this._listFiles(resolved);
    await mkdir(dest, { recursive: true });

    for (const file of files) {
      if (file.is_dir) continue;
      const url = `${this._baseUrl}/v2/box/${this.id}/files/download?path=${encodeURIComponent(file.path)}`;
      const response = await fetch(url, { headers: this._headers });
      if (!response.ok) {
        throw new BoxError(`Failed to download ${file.path}`, response.status);
      }
      const buf = Buffer.from(await response.arrayBuffer());
      await fsWriteFile(join(dest, file.name), buf);
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
   * Pause the box (release compute, preserve state).
   */
  async pause(): Promise<void> {
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
  static async fromSnapshot(snapshotId: string, config: BoxConfig): Promise<Box> {
    const apiKey = config.apiKey ?? process.env.UPSTASH_BOX_API_KEY;
    if (!apiKey) {
      throw new BoxError(
        "apiKey is required. Pass it in config or set UPSTASH_BOX_API_KEY env var.",
      );
    }

    const baseUrl = (
      config.baseUrl ??
      process.env.UPSTASH_BOX_BASE_URL ??
      DEFAULT_BASE_URL
    ).replace(/\/$/, "");
    const headers: Record<string, string> = { "X-Box-Api-Key": apiKey };
    const timeout = config.timeout ?? 600000;
    const debug = config.debug ?? false;

    const body: Record<string, unknown> = {
      snapshot_id: snapshotId,
    };
    if (config.agent) {
      if (!config.agent.apiKey) {
        throw new BoxError("Agent API key is undefined. Please provide a valid provider API key.");
      }
      body.model = config.agent.model;
      body.agent_api_key = config.agent.apiKey;
    }
    if (config.runtime) body.runtime = config.runtime;
    if (config.git?.token) body.github_token = config.git.token;

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
      gitToken: config.git?.token,
      isAgentConfigured: Boolean(config.agent),
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

  // ==================== Git (private, exposed via this.git) ====================

  private async _gitClone(options: GitCloneOptions): Promise<void> {
    await this._request("POST", `/v2/box/${this.id}/git/clone`, {
      body: {
        repo: options.repo,
        branch: options.branch,
        github_token: this._gitToken,
      },
    });
  }

  private async _gitDiff(): Promise<string> {
    const data = await this._request<{ diff: string }>("GET", `/v2/box/${this.id}/git/diff`);
    return data.diff;
  }

  private async _gitStatus(): Promise<string> {
    const data = await this._request<{ status: string }>("GET", `/v2/box/${this.id}/git/status`);
    return data.status;
  }

  private async _gitCommit(options: { message: string }): Promise<GitCommitResult> {
    return this._request<GitCommitResult>("POST", `/v2/box/${this.id}/git/commit`, {
      body: { message: options.message },
    });
  }

  private async _gitPush(options?: { branch?: string }): Promise<void> {
    await this._request("POST", `/v2/box/${this.id}/git/push`, {
      body: { branch: options?.branch },
    });
  }

  private async _gitCreatePR(options: GitPROptions): Promise<PullRequest> {
    return this._request<PullRequest>("POST", `/v2/box/${this.id}/git/create-pr`, {
      body: { title: options.title, body: options.body, base: options.base },
    });
  }
}

// ==================== Helpers ====================

/** @internal */
export function extractSchemaShape(schema: SchemaLike<unknown>): string | null {
  try {
    const s = schema as unknown as Record<string, unknown>;
    if (s.shape && typeof s.shape === "object") {
      const shape = s.shape as Record<
        string,
        { _def?: { typeName?: string; type?: { _def?: { typeName?: string } } } }
      >;
      const fields: Record<string, string> = {};
      for (const [key, val] of Object.entries(shape)) {
        fields[key] = zodTypeToExample(val);
      }
      return JSON.stringify(fields, null, 2);
    }
  } catch {
    // Not a Zod schema or can't introspect
  }
  return null;
}

/** @internal */
export function zodTypeToExample(field: unknown): string {
  const f = field as { _def?: { typeName?: string; type?: unknown } };
  const typeName = f?._def?.typeName;
  switch (typeName) {
    case "ZodString":
      return "string";
    case "ZodNumber":
      return "number";
    case "ZodBoolean":
      return "boolean";
    case "ZodArray":
      return `[${zodTypeToExample(f._def?.type)}]`;
    default:
      return "any";
  }
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

async function sendWebhook(config: WebhookConfig, payload: WebhookPayload): Promise<void> {
  try {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...config.headers,
    };

    if (config.secret) {
      const signature = createHmac("sha256", config.secret).update(body).digest("hex");
      headers["X-Box-Signature"] = signature;
    }

    await fetch(config.url, { method: "POST", headers, body });
  } catch {
    // Webhook delivery is best-effort
  }
}
