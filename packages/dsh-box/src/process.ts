/**
 * One managed process running inside the shared Upstash Box.
 *
 * The seam's `spawn()` is synchronous while opening a session is not, so the
 * handle publishes immediately and the session is attached when its handshake
 * completes. `pid` is `-1` only for that window: the server sends the real
 * in-box pid in its first frame and refuses to start a session it cannot
 * signal, so no wrapper or status file is needed to learn it.
 */

import { Buffer } from "node:buffer";
import { inspect } from "node:util";
import { Readable, Writable } from "node:stream";
import type { ExecSessionHandle } from "@upstash/box";
import type { BoxRuntime } from "./index.js";
import type {
  SubprocessCollect,
  SubprocessCollectedOutputs,
  SubprocessHandle,
  SubprocessOutcome,
  SubprocessOutputMode,
  SubprocessSpawnSpec,
} from "@deepseek-ai/dsh-subprocess";
import { deferred, type Deferred } from "./deferred.js";
import { BoxOutputReader } from "./output.js";

function isCollect(mode: SubprocessOutputMode): mode is SubprocessCollect {
  return typeof mode === "object";
}

/**
 * Build the child environment from the caller's explicit entries only.
 *
 * A local provider starts from `scrubbedParentEnv()` because the parent process
 * and the child share one machine. This provider does not: the harness runs
 * here and the process runs in the box, so this host's `PATH`, `HOME`, `USER`,
 * `SSH_AUTH_SOCK`, locale, and CI variables describe a world the box does not
 * have. Copying them in would let host ambient state reach a remote process
 * implicitly, and the credential-shaped scrub is a name heuristic, not a
 * boundary. The box keeps its own environment; only `spec.env` crosses.
 *
 * The server drops its own blocked names (`PATH`, `HOME`, `LD_PRELOAD`,
 * `LD_LIBRARY_PATH`, `NODE_OPTIONS`) on top of this, which is a deliberate
 * server-side control this adapter does not route around.
 * @param specEnv - Explicit entries from the spawn spec.
 * @returns `KEY=VALUE` strings for the session.
 */
export function sessionEnv(specEnv: NodeJS.ProcessEnv | undefined): string[] {
  const entries: string[] = [];
  for (const [key, value] of Object.entries(specEnv ?? {})) {
    if (key.length === 0 || key.includes("=") || key.includes("\0")) {
      throw new Error(`subprocess-box: invalid environment name ${JSON.stringify(key)}`);
    }
    if (value?.includes("\0") === true) {
      throw new Error(`subprocess-box: environment value for ${key} contains NUL`);
    }
    // A tombstone carries no value to transport; removal is applied by the
    // wrapper below, which is the only way to actually unset a name.
    if (value !== undefined) entries.push(`${key}=${value}`);
  }
  return entries;
}

/**
 * Names the caller asked to remove.
 * @param specEnv - Explicit entries from the spawn spec.
 * @returns the tombstoned names, in spec order.
 */
export function removedEnvNames(specEnv: NodeJS.ProcessEnv | undefined): string[] {
  return Object.entries(specEnv ?? {})
    .filter(([, value]) => value === undefined)
    .map(([key]) => key);
}

/**
 * Apply removals inside the launched process.
 *
 * The session protocol overlays `KEY=VALUE` entries and has no removal verb, so
 * a tombstone can only take effect in the child itself. `env -u NAME -- argv`
 * does exactly that and nothing else: it does not carry values, so the server's
 * blocked-name policy still applies to everything this adapter sends.
 * @param argv - the caller's exact program and arguments.
 * @param removed - names to unset for the child.
 * @returns argv to launch, wrapped only when there is something to remove.
 */
export function argvWithRemovals(argv: readonly string[], removed: readonly string[]): string[] {
  if (removed.length === 0) return [...argv];
  return ["/usr/bin/env", ...removed.flatMap((name) => ["-u", name]), "--", ...argv];
}

/** A live Box-backed process exposed through the subprocess seam. */
export class BoxSubprocessHandle implements SubprocessHandle {
  /** @inheritdoc */
  pid = -1;
  /** @inheritdoc */
  readonly stdin: Writable | undefined;
  /** @inheritdoc */
  readonly stdout: Readable | undefined;
  /** @inheritdoc */
  readonly stderr: Readable | undefined;
  /** @inheritdoc */
  readonly collected: SubprocessCollectedOutputs;
  /** @inheritdoc */
  readonly done: Promise<SubprocessOutcome>;

  private readonly stdoutReader: BoxOutputReader | undefined;
  private readonly stderrReader: BoxOutputReader | undefined;
  private session: ExecSessionHandle | undefined;
  private exited = false;
  private terminateRequested = false;
  private abandoned = false;
  /** Resolves with the open session, so stdin writes can wait for it. */
  private readonly sessionReady: Deferred<ExecSessionHandle>;
  private readonly settled: Deferred<SubprocessOutcome>;
  private readonly onAbort: () => void;

  constructor(
    private readonly owner: BoxRuntime,
    private readonly spec: SubprocessSpawnSpec,
  ) {
    this.stdoutReader = isCollect(spec.stdio.stdout)
      ? new BoxOutputReader(spec.stdio.stdout.maxBytes)
      : undefined;
    this.stderrReader = isCollect(spec.stdio.stderr)
      ? new BoxOutputReader(spec.stdio.stderr.maxBytes)
      : undefined;
    // exactOptionalPropertyTypes: a stream that was not collected omits its key.
    this.collected = {
      ...(this.stdoutReader === undefined ? {} : { stdout: this.stdoutReader }),
      ...(this.stderrReader === undefined ? {} : { stderr: this.stderrReader }),
    };

    this.stdout = spec.stdio.stdout === "pipe" ? new Readable({ read() {} }) : undefined;
    this.stderr = spec.stdio.stderr === "pipe" ? new Readable({ read() {} }) : undefined;
    this.stdin = spec.stdio.stdin === "pipe" ? this.createStdin() : undefined;

    this.settled = deferred<SubprocessOutcome>();
    this.done = this.settled.promise;
    void this.done.catch(() => undefined);
    this.sessionReady = deferred<ExecSessionHandle>();
    // Observed so a failed handshake cannot surface as an unhandled rejection
    // when nothing is writing to stdin.
    void this.sessionReady.promise.catch(() => undefined);

    // A long-lived controller shared across spawns would otherwise retain every
    // completed handle, so the listener is removed when this one settles.
    this.onAbort = () => {
      this.terminate();
    };
    spec.signal?.addEventListener("abort", this.onAbort, { once: true });

    void this.start().catch((error: unknown) => {
      this.sessionReady.reject(error);
      this.finish(error);
    });
  }

  private createStdin(): Writable {
    // Each callback waits for the session rather than completing straight into
    // a private array. Holding it pending is what applies the Writable's high
    // water mark, so a producer cannot enqueue unbounded input into host memory
    // while a slow handshake is still in flight.
    return new Writable({
      write: (chunk: Buffer | string, _encoding, callback) => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        this.sessionReady.promise.then(
          (session) => {
            // write() throws synchronously if the socket closed between
            // readiness and here. Inside an unobserved then() that would skip
            // the callback, wedging the Writable forever, and surface as an
            // unhandled rejection instead of a stream error.
            try {
              if (!this.exited) session.write(bytes);
              callback();
            } catch (error: unknown) {
              callback(error instanceof Error ? error : new Error(inspect(error)));
            }
          },
          (error: unknown) => {
            callback(error instanceof Error ? error : new Error(inspect(error)));
          },
        );
      },
      final: (callback) => {
        this.sessionReady.promise.then(
          (session) => {
            try {
              if (!this.exited) session.endStdin();
              callback();
            } catch (error: unknown) {
              callback(error instanceof Error ? error : new Error(inspect(error)));
            }
          },
          () => {
            // The spawn already failed; `done` carries that outcome.
            callback();
          },
        );
      },
    });
  }

  private deliver(
    mode: SubprocessOutputMode,
    reader: BoxOutputReader | undefined,
    stream: Readable | undefined,
    data: Uint8Array,
    inherited: NodeJS.WriteStream,
  ): void {
    if (isCollect(mode)) reader?.push(data);
    else if (mode === "pipe") stream?.push(Buffer.from(data));
    // A remote process has no descriptor to inherit, so `inherit` copies its
    // bytes onto the harness's own stream. Output lands in the same place a
    // local inherit would put it; the child cannot detect a TTY through it.
    else if (mode === "inherit") inherited.write(Buffer.from(data));
  }

  private async start(): Promise<void> {
    const box = await this.owner.getBox();
    const session = await box.exec.session({
      argv: argvWithRemovals(this.spec.argv, removedEnvNames(this.spec.env)),
      cwd: this.spec.cwd,
      env: sessionEnv(this.spec.env),
      onStdout: (data) => {
        this.deliver(this.spec.stdio.stdout, this.stdoutReader, this.stdout, data, process.stdout);
      },
      onStderr: (data) => {
        this.deliver(this.spec.stdio.stderr, this.stderrReader, this.stderr, data, process.stderr);
      },
    });
    this.session = session;
    this.pid = session.pid;

    // Disposal already stopped waiting for this handshake, so this session has
    // no owner left to terminate it. Stop it here rather than leave a process
    // running in a box the owner is about to delete.
    if (this.abandoned) {
      try {
        session.terminate(this.spec.graceMs);
        session.close();
      } catch (_alreadyClosing) {
        // The socket is already going away, which is the desired end state.
      }
      this.sessionReady.reject(new Error("subprocess-box: session abandoned during disposal"));
      return;
    }

    // A short command can exit while the handshake is still settling, which
    // closes the socket underneath these calls. Losing stdin to a process that
    // has already gone is not a spawn failure, so it must not reject `done`.
    try {
      if (this.terminateRequested) {
        // Cancellation arrived during the handshake. Delivering queued input
        // first would let the command do work after it was already cancelled,
        // so the stop goes out and the input is dropped.
        session.terminate(this.spec.graceMs);
      } else {
        const stdinMode = this.spec.stdio.stdin;
        if (typeof stdinMode === "object") {
          session.write(stdinMode.data);
          session.endStdin();
        } else if (stdinMode === "ignore") {
          session.endStdin();
        }
        // Piped writes are released by resolving sessionReady below.
      }
    } catch (_raceWithProcessExit) {
      // The exit code below is the authoritative outcome.
    }
    this.sessionReady.resolve(session);

    const code = await session.wait();
    this.finish(undefined, code);
  }

  private finish(error?: unknown, code?: number): void {
    if (this.exited) return;
    this.exited = true;
    this.spec.signal?.removeEventListener("abort", this.onAbort);
    this.stdout?.push(null);
    this.stderr?.push(null);
    if (error !== undefined) {
      this.settled.reject(error instanceof Error ? error : new Error(inspect(error)));
      return;
    }
    const exitCode = code ?? -1;
    // The SDK reports -1 when a live session loses its connection or ends
    // without an exit frame; a real exit always carries its code. Resolving it
    // would misreport a transport failure as a process that exited with -1.
    if (exitCode === -1) {
      this.settled.reject(new Error("dsh-box: process session ended without an exit code"));
      return;
    }
    // The server reports an exit code and nothing else. Requesting termination
    // does not prove which signal produced that code: a process can catch
    // SIGTERM and exit 143 or 137 on its own, so naming a signal here would
    // fabricate a fact and discard the real exit code. Report what the server
    // actually said until the protocol carries a signal of its own.
    this.settled.resolve({ exitCode, signal: null });
  }

  /** @inheritdoc */
  terminate(): void {
    if (this.exited) return;
    this.terminateRequested = true;
    // Idempotent server-side: the agent guards the escalation with a sync.Once,
    // so repeat calls do not start a second TERM/KILL sequence.
    this.session?.terminate(this.spec.graceMs);
  }

  /**
   * Give up on a handshake that has not produced a session yet.
   *
   * `terminate()` can only set a flag while `box.exec.session()` is still in
   * flight, and `waitForExit()` then blocks on `done`, which only settles when
   * that handshake does. A stalled one would hold service disposal for the whole
   * request timeout. A session that lands afterwards is stopped by `start()`.
   *
   * No-op once a session exists: that handle terminates and exits normally.
   */
  abandon(): void {
    if (this.exited || this.session !== undefined) return;
    this.abandoned = true;
    this.terminateRequested = true;
    this.finish(new Error("subprocess-box: service disposed before the session was established"));
  }

  /** @inheritdoc */
  async waitForExit(signal?: AbortSignal): Promise<boolean> {
    if (this.exited) return true;
    if (signal === undefined) {
      await this.done.catch(() => undefined);
      return true;
    }
    let onAbort!: () => void;
    const aborted = new Promise<false>((resolve) => {
      onAbort = () => {
        resolve(false);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      // Re-check behind registration: an abort between the caller's check and
      // this listener would otherwise never resolve the race.
      if (signal.aborted) resolve(false);
    });
    try {
      return await Promise.race([
        this.done.then(
          () => true,
          () => true,
        ),
        aborted,
      ]);
    } finally {
      // Repeated bounded waits on one long-lived signal would otherwise retain
      // a listener per call.
      signal.removeEventListener("abort", onAbort);
    }
  }

  /** Stop the session outright; used by service disposal after termination. */
  close(): void {
    this.session?.close();
  }
}
