import { readFile as fsReadFile, writeFile as fsWriteFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";

import type {
  BoxConfig,
  BoxData,
  RunOptions,
  RunResult,
  RunMetadata,
  ExecResult,
  ErrorResponse,
  FileEntry,
  GitCloneOptions,
  GitPROptions,
  GitCommitResult,
  LogEntry,
  CostBreakdown,
  UploadFileEntry,
  DownloadOptions,
} from "./types.js";

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
 * Handle to a running or pending prompt execution.
 *
 * Consume with either `stream()` (for streaming text) or `result()` (for structured output).
 * After consumption, call `cost()` to get token usage.
 */
export class Run {
  private box: Box;
  private options: RunOptions;
  private _completed = false;
  private _started = false;
  private _metadata?: RunMetadata;
  private _output?: string;

  /** @internal */
  constructor(box: Box, options: RunOptions) {
    this.box = box;
    this.options = options;
  }

  /**
   * Stream the run output as text chunks.
   *
   * @example
   * ```ts
   * const run = await box.run({ prompt: "Explain this codebase" });
   * for await (const chunk of run.stream()) {
   *   process.stdout.write(chunk);
   * }
   * ```
   */
  async *stream(): AsyncGenerator<string> {
    if (this._started) {
      throw new BoxError("Run already started. Each Run can only be consumed once.");
    }
    this._started = true;

    const url = `${this.box["_baseUrl"]}/v2/box/${this.box.id}/run/stream`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...this.box["_headers"],
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prompt: this.options.prompt }),
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
    let fullOutput = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        let chunk = decoder.decode(value, { stream: true });
        // Strip ANSI escape codes (from TTY spinner output)
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
            const text = this.processSSEEvent(eventType, eventData);
            if (text !== null) {
              fullOutput += text;
              yield text;
            }
            eventType = "";
            eventData = "";
          }
        }

        if (eventType && eventData && (buffer === "" || buffer.trim() === "")) {
          const text = this.processSSEEvent(eventType, eventData);
          if (text !== null) {
            fullOutput += text;
            yield text;
          }
          eventType = "";
          eventData = "";
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        buffer = buffer.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "");
        const lines = buffer.split("\n");
        for (let line of lines) {
          line = line.replace(/\r$/, "").replace(/^[\\\|\/\-\s]*/, "");
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            eventData = line.slice(6);
          } else if (line.trim() === "" && eventType && eventData) {
            const text = this.processSSEEvent(eventType, eventData);
            if (text !== null) {
              fullOutput += text;
              yield text;
            }
            eventType = "";
            eventData = "";
          }
        }
      }

      if (eventType && eventData) {
        const text = this.processSSEEvent(eventType, eventData);
        if (text !== null) {
          fullOutput += text;
          yield text;
        }
      }
    } finally {
      this._completed = true;
      this._output = this._output ?? fullOutput;
    }
  }

  /**
   * Wait for the run to complete and return the parsed result.
   * Use this with `responseSchema` for structured output.
   *
   * @example
   * ```ts
   * const run = await box.run({
   *   prompt: "Extract data from this file",
   *   responseSchema: myZodSchema,
   * });
   * const data = await run.result();
   * ```
   */
  async result<T = string>(): Promise<T> {
    if (this._started && !this._completed) {
      throw new BoxError("Run is currently streaming. Cannot call result() while streaming.");
    }

    if (this._completed && this._output !== undefined) {
      return parseOutput<T>(this._output);
    }

    this._started = true;

    const result = await this.box["request"]<RunResult>(
      "POST",
      `/v2/box/${this.box.id}/run`,
      { body: { prompt: this.options.prompt } },
    );

    this._output = result.output;
    this._metadata = result.metadata;
    this._completed = true;

    return parseOutput<T>(result.output);
  }

  /**
   * Get cost breakdown after the run has completed.
   */
  async cost(): Promise<CostBreakdown> {
    if (!this._completed) {
      throw new BoxError("Run has not completed yet. Call stream() or result() first.");
    }
    const meta = this._metadata;
    const inputTokens = meta?.inputTokens ?? 0;
    const outputTokens = meta?.outputTokens ?? 0;
    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      totalUsd: 0,
    };
  }

  private processSSEEvent(type: string, data: string): string | null {
    try {
      const parsed = JSON.parse(data);
      switch (type) {
        case "text":
          return parsed.text ?? null;
        case "done":
          this._output = parsed.output;
          this._metadata = parsed.metadata;
          this._completed = true;
          return null;
        case "error":
          throw new BoxError(typeof parsed === "string" ? parsed : parsed.error ?? "Stream error");
        default:
          return null;
      }
    } catch (e) {
      if (e instanceof BoxError) throw e;
      return null;
    }
  }
}

/**
 * Result of a shell command execution.
 */
export class ShellResult {
  readonly output: string;
  readonly exitCode: number;
  readonly error?: string;
  private _computeMs: number;

  /** @internal */
  constructor(result: ExecResult, computeMs: number) {
    this.output = result.output;
    this.exitCode = result.exit_code;
    this.error = result.error;
    this._computeMs = computeMs;
  }

  async cost(): Promise<{ computeMs: number }> {
    return { computeMs: this._computeMs };
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
 *   apiKey: process.env.UPSTASH_BOX_API_KEY!,
 *   runtime: Runtime.Node,
 *   agent: {
 *     model: ClaudeCode.Sonnet_4,
 *     apiKey: process.env.CLAUDE_KEY!,
 *   },
 * });
 *
 * const run = await box.run({ prompt: "Hello world" });
 * for await (const chunk of run.stream()) {
 *   process.stdout.write(chunk);
 * }
 *
 * await box.delete();
 * ```
 */
export class Box {
  readonly id: string;

  /** Git operations namespace */
  readonly git: {
    clone: (options: GitCloneOptions) => Promise<void>;
    diff: () => Promise<string>;
    status: () => Promise<string>;
    commit: (options: { message: string }) => Promise<GitCommitResult>;
    push: (options?: { branch?: string }) => Promise<void>;
    createPR: (options: GitPROptions) => Promise<string>;
  };

  private _baseUrl: string;
  private _headers: Record<string, string>;
  private _timeout: number;
  private _debug: boolean;
  private _gitToken?: string;

  private constructor(
    data: BoxData,
    config: {
      baseUrl: string;
      headers: Record<string, string>;
      timeout: number;
      debug: boolean;
      gitToken?: string;
    },
  ) {
    this.id = data.id;
    this._baseUrl = config.baseUrl;
    this._headers = config.headers;
    this._timeout = config.timeout;
    this._debug = config.debug;
    this._gitToken = config.gitToken;

    this.git = {
      clone: (options) => this.gitClone(options),
      diff: () => this.gitDiff(),
      status: () => this.gitStatus(),
      commit: (options) => this.gitCommit(options),
      push: (options) => this.gitPush(options),
      createPR: (options) => this.gitCreatePR(options),
    };
  }

  /**
   * Create a new sandboxed box.
   *
   * @example
   * ```ts
   * const box = await Box.create({
   *   runtime: Runtime.Node,
   *   agent: {
   *     model: ClaudeCode.Opus_4_5,
   *     apiKey: process.env.CLAUDE_KEY!,
   *   },
   *   git: {
   *     token: process.env.GITHUB_TOKEN!,
   *   },
   * });
   * ```
   */
  static async create(config: BoxConfig): Promise<Box> {
    const apiKey = config.apiKey ?? process.env.UPSTASH_BOX_API_KEY;
    if (!apiKey) {
      throw new BoxError("apiKey is required. Pass it in config or set UPSTASH_BOX_API_KEY env var.");
    }
    if (!config.agent?.apiKey) {
      throw new BoxError("agent.apiKey is required");
    }
    if (!config.agent?.model) {
      throw new BoxError("agent.model is required");
    }

    const baseUrl = (config.baseUrl ?? process.env.UPSTASH_BOX_BASE_URL ?? "https://api.upstash.com").replace(/\/$/, "");
    const headers: Record<string, string> = {
      "X-Box-Api-Key": apiKey,
    };
    const timeout = config.timeout ?? 600000;
    const debug = config.debug ?? false;

    const body: Record<string, unknown> = {
      model: config.agent.model,
      agent_api_key: config.agent.apiKey,
    };
    if (config.runtime) body.runtime = config.runtime;
    if (config.git?.token) body.github_token = config.git.token;

    // Create the box
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

    // Poll until ready (box creation is async on the backend)
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

    return new Box(data, { baseUrl, headers, timeout, debug, gitToken: config.git?.token });
  }

  // ==================== Run ====================

  /**
   * Run a prompt in this box.
   * Returns a Run handle — consume with `stream()` or `result()`.
   *
   * @example
   * ```ts
   * const run = await box.run({ prompt: "Fix the bug in auth.ts" });
   * for await (const chunk of run.stream()) {
   *   process.stdout.write(chunk);
   * }
   * ```
   */
  async run(options: RunOptions): Promise<Run> {
    if (!options.prompt) throw new BoxError("prompt is required");
    return new Run(this, options);
  }

  // ==================== Shell ====================

  /**
   * Execute a shell command in the box.
   *
   * @example
   * ```ts
   * const result = await box.shell("ls -la /work");
   * console.log(result.output);
   * ```
   */
  async shell(command: string): Promise<ShellResult> {
    const start = Date.now();
    const result = await this.request<ExecResult>("POST", `/v2/box/${this.id}/exec`, {
      body: { command: ["sh", "-c", command] },
    });
    return new ShellResult(result, Date.now() - start);
  }

  // ==================== File Operations ====================

  /**
   * Read a file from the box.
   *
   * @example
   * ```ts
   * const content = await box.readFile("/work/output.md");
   * ```
   */
  async readFile(path: string): Promise<string> {
    const data = await this.request<{ content: string }>(
      "GET",
      `/v2/box/${this.id}/files/read?path=${encodeURIComponent(path)}`,
    );
    return data.content;
  }

  /**
   * Write a file to the box.
   */
  async writeFile(path: string, content: string): Promise<void> {
    await this.request("POST", `/v2/box/${this.id}/files/write`, {
      body: { path, content },
    });
  }

  /**
   * List files in a directory inside the box.
   */
  async listFiles(path?: string): Promise<FileEntry[]> {
    const p = path ? `?path=${encodeURIComponent(path)}` : "";
    const data = await this.request<{ files: FileEntry[] }>(
      "GET",
      `/v2/box/${this.id}/files/list${p}`,
    );
    return data.files;
  }

  /**
   * Upload local files into the box.
   *
   * @example
   * ```ts
   * await box.uploadFiles([
   *   { path: "./local/file.pdf", mountPath: "/work/file.pdf" },
   * ]);
   * ```
   */
  async uploadFiles(files: UploadFileEntry[]): Promise<void> {
    for (const file of files) {
      const content = await fsReadFile(file.path);
      const base64 = content.toString("base64");
      await this.request("POST", `/v2/box/${this.id}/files/write`, {
        body: { path: file.mountPath, content: base64, encoding: "base64" },
      });
    }
  }

  /**
   * Download files from the box to the local filesystem.
   *
   * @example
   * ```ts
   * await box.downloadFiles({ path: "/work/output" });
   * ```
   */
  async downloadFiles(options: DownloadOptions): Promise<void> {
    const remotePath = options.path;
    const dest = options.dest ?? `./${basename(remotePath)}`;

    const files = await this.listFiles(remotePath);
    await mkdir(dest, { recursive: true });

    for (const file of files) {
      if (file.is_dir) continue;
      const url = `${this._baseUrl}/v2/box/${this.id}/files/download?path=${encodeURIComponent(file.path)}`;
      const response = await fetch(url, { headers: this._headers });
      if (!response.ok) {
        throw new BoxError(`Failed to download ${file.path}`, response.status);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      await fsWriteFile(join(dest, file.name), buffer);
    }
  }

  // ==================== Lifecycle ====================

  /**
   * Get the current box status.
   */
  async getStatus(): Promise<{ status: string }> {
    return this.request<{ status: string }>("GET", `/v2/box/${this.id}/status`);
  }

  /**
   * Stop the box (release compute, keep state).
   */
  async stop(): Promise<void> {
    await this.request("POST", `/v2/box/${this.id}/stop`);
  }

  /**
   * Start a stopped box.
   */
  async start(): Promise<void> {
    await this.request("POST", `/v2/box/${this.id}/start`);
  }

  /**
   * Delete this box permanently.
   */
  async delete(): Promise<void> {
    await this.request("DELETE", `/v2/box/${this.id}`);
  }

  /**
   * Get structured logs for this box.
   */
  async logs(options?: { offset?: number; limit?: number }): Promise<LogEntry[]> {
    const params = new URLSearchParams();
    if (options?.offset) params.set("offset", String(options.offset));
    if (options?.limit) params.set("limit", String(options.limit));
    const qs = params.toString() ? `?${params.toString()}` : "";
    const data = await this.request<{ logs: LogEntry[] }>("GET", `/v2/box/${this.id}/logs${qs}`);
    return data.logs;
  }

  // ==================== Internal ====================

  private log(...args: unknown[]) {
    if (this._debug) console.log("[Box]", ...args);
  }

  private async request<T>(
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

  private async gitClone(options: GitCloneOptions): Promise<void> {
    await this.request("POST", `/v2/box/${this.id}/git/clone`, {
      body: {
        repo: options.repo,
        branch: options.branch,
        github_token: this._gitToken,
      },
    });
  }

  private async gitDiff(): Promise<string> {
    const data = await this.request<{ diff: string }>("GET", `/v2/box/${this.id}/git/diff`);
    return data.diff;
  }

  private async gitStatus(): Promise<string> {
    const data = await this.request<{ status: string }>("GET", `/v2/box/${this.id}/git/status`);
    return data.status;
  }

  private async gitCommit(options: { message: string }): Promise<GitCommitResult> {
    return this.request<GitCommitResult>("POST", `/v2/box/${this.id}/git/commit`, {
      body: { message: options.message },
    });
  }

  private async gitPush(options?: { branch?: string }): Promise<void> {
    await this.request("POST", `/v2/box/${this.id}/git/push`, {
      body: { branch: options?.branch },
    });
  }

  private async gitCreatePR(options: GitPROptions): Promise<string> {
    const data = await this.request<{ url: string }>("POST", `/v2/box/${this.id}/git/create-pr`, {
      body: { title: options.title, body: options.body, base: options.base },
    });
    return data.url;
  }
}

// ==================== Helpers ====================

function parseOutput<T>(output: string): T {
  try {
    return JSON.parse(output) as T;
  } catch {
    return output as T;
  }
}

async function parseErrorResponse(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as ErrorResponse;
    return data.error ?? `Request failed with status ${response.status}`;
  } catch {
    return `Request failed with status ${response.status}`;
  }
}
