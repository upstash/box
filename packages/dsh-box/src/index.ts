/**
 * Shared ownership of one Upstash Box. Capability adapters await the same SDK
 * handle, so filesystem and process operations inhabit one remote Linux world.
 * @module @upstash/dsh-box
 */

import { posix } from "node:path";
import { Context, Service } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { Box } from "@upstash/box";

export { Box, BoxError } from "@upstash/box";
export type { ExecSessionHandle, ExecSessionOptions, FileStat } from "@upstash/box";

/**
 * Quote one opaque argument for the control-shell layer this owner and its
 * adapters use for probes.
 * @param value - Exact argument value to preserve.
 * @returns A single shell word with no interpolation.
 */
export function quoteBoxShellArg(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

/**
 * Whether a delete failed because the box is already gone.
 * @param error - The rejection from the SDK.
 * @returns true when teardown's goal is already satisfied.
 */
function isAlreadyGone(error: unknown): boolean {
  if ((error as { statusCode?: number } | undefined)?.statusCode === 404) return true;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("not found") || message.includes("does not exist");
}

/** Configuration for the shared Upstash Box owner. */
export interface Config {
  /** API key; omission reads `UPSTASH_BOX_API_KEY`. It is never forwarded into the box. */
  apiKey?: string;
  /** API base URL; omission reads `UPSTASH_BOX_BASE_URL`, then the SDK default. */
  baseUrl?: string;
  /** Shared remote working directory, created before adapters receive the box. */
  cwd?: string;
  /** Box runtime image. */
  runtime?: "node" | "python" | "golang" | "ruby" | "rust";
  /**
   * Per-request HTTP timeout in milliseconds handed to the SDK. This is not a
   * box lifetime: a box outlives any single request and is deleted at disposal.
   */
  requestTimeoutMs?: number;
}

interface ResolvedConfig {
  apiKey: string;
  baseUrl: string | undefined;
  cwd: string;
  runtime: "node" | "python" | "golang" | "ruby" | "rust";
  requestTimeoutMs: number;
}

interface SchemaResolvedConfig extends Config {
  cwd: string;
  runtime: "node" | "python" | "golang" | "ruby" | "rust";
  requestTimeoutMs: number;
}

declare module "@deepseek-ai/cordis" {
  interface Context {
    box: BoxRuntime;
  }
}

/**
 * Creates one lazily consumable Upstash Box handle and deletes the box at
 * disposal. Creation begins at plugin construction; adapters await
 * {@link getBox} before their first operation.
 */
export class BoxRuntime extends Service {
  static Config: z<Config> = z.object({
    apiKey: z.string(),
    baseUrl: z.string(),
    cwd: z.string().default("/workspace/home"),
    runtime: z.union(["node", "python", "golang", "ruby", "rust"] as const).default("node"),
    requestTimeoutMs: z.number().default(600_000),
  });

  /** Validated remote working directory shared by provider adapters. */
  readonly cwd: string;
  /** Remote directory reserved for adapter-owned process state. */
  readonly runtimeRoot: string;

  private readonly config: ResolvedConfig;
  private readonly ready: Promise<Box>;
  /** Set as soon as a box exists, so teardown can delete one whose setup failed. */
  private acquired: Box | undefined;
  private disposed = false;

  constructor(ctx: Context, config: Config) {
    super(ctx, "box");
    // Schemastery fills these fields before construction; the type does not encode that step.
    const resolved = config as SchemaResolvedConfig;
    const apiKey = config.apiKey ?? process.env.UPSTASH_BOX_API_KEY;
    this.config = {
      apiKey: apiKey ?? "",
      baseUrl: config.baseUrl ?? process.env.UPSTASH_BOX_BASE_URL,
      cwd: resolved.cwd,
      runtime: resolved.runtime,
      requestTimeoutMs: resolved.requestTimeoutMs,
    };
    this.validate();
    this.cwd = this.config.cwd;
    this.runtimeRoot = posix.join(this.cwd, ".dsh-box");
    this.ready = this.open();
    // A deployment may load the owner before any adapter uses it. Keep a
    // failed eager connection observed; getBox() still returns the error.
    void this.ready.catch(() => {});

    ctx.effect(
      () => async () => {
        this.disposed = true;
        // Prefer the resolved handle, but fall back to a box whose setup failed
        // after allocation: open()'s rollback may itself have failed, and this
        // is the only remaining chance to delete it.
        const box = await this.ready.catch(() => this.acquired);
        if (box === undefined) return;
        try {
          await box.delete();
        } catch (error: unknown) {
          // A box deleted by its own idle cleanup (or a racing caller) is already
          // in the state teardown wants; anything else stays observable.
          if (!isAlreadyGone(error)) throw error;
        }
      },
      "box teardown",
    );
  }

  /**
   * Return the shared live SDK handle.
   * @returns the created box after the configured cwd exists.
   * @throws when the API rejects creation or the service is disposing.
   */
  async getBox(): Promise<Box> {
    this.assertLive();
    const box = await this.ready;
    // Disposal can race the awaited box readiness despite the synchronous
    // precheck, so re-check behind the await.
    this.assertLive();
    return box;
  }

  private assertLive(): void {
    if (this.disposed) throw new Error("Upstash Box service is disposing");
  }

  private validate(): void {
    if (this.config.apiKey.length === 0) {
      throw new Error("dsh-box: configure apiKey or set UPSTASH_BOX_API_KEY");
    }
    if (!posix.isAbsolute(this.config.cwd)) {
      throw new Error(`dsh-box: cwd must be an absolute Linux path: ${this.config.cwd}`);
    }
    if (!Number.isFinite(this.config.requestTimeoutMs) || this.config.requestTimeoutMs <= 0) {
      throw new Error("dsh-box: requestTimeoutMs must be a positive finite number");
    }
  }

  private async open(): Promise<Box> {
    const box = await Box.create({
      apiKey: this.config.apiKey,
      ...(this.config.baseUrl === undefined ? {} : { baseUrl: this.config.baseUrl }),
      runtime: this.config.runtime,
      timeout: this.config.requestTimeoutMs,
      // No keepAlive: the coordinator refreshes box activity for the life of an
      // open exec session, so an idle-pause cannot land under a running process,
      // and a paused box auto-resumes on the next call.
    });
    this.acquired = box;
    try {
      await box.files.mkdir(this.cwd, { parents: true });
      await box.files.mkdir(this.runtimeRoot, { parents: true });
      const runtimeRoot = await box.files.stat(this.runtimeRoot);
      if (runtimeRoot.type !== "directory") {
        throw new Error(`dsh-box: runtime root must be a real directory: ${this.runtimeRoot}`);
      }
      await box.exec.command(`chmod 700 -- ${quoteBoxShellArg(this.runtimeRoot)}`);
      return box;
    } catch (error: unknown) {
      try {
        await box.delete();
      } catch (_boxSetupRollbackFailure) {
        // Deliberate: the open failure below is the diagnostic worth keeping,
        // and rethrowing here would replace it with a teardown error. The box
        // stays in `acquired`, so disposal retries the delete rather than
        // leaking it.
      }
      throw error;
    }
  }
}

export default BoxRuntime;
