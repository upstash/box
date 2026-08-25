/**
 * Upstash Box Service Provider for the subprocess capability seam. Each handle
 * is one live exec session in the shared box: the session owns the process
 * tree, so losing it stops the work rather than orphaning it.
 * @module @upstash/dsh-box/subprocess
 */

import { posix } from "node:path";
import { inspect } from "node:util";
import { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { SubprocessRuntime } from "@deepseek-ai/dsh-subprocess";
import { MAX_TIMER_DELAY_MS } from "@deepseek-ai/dsh-timeout";
import type {
  SubprocessHandle,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from "@deepseek-ai/dsh-subprocess";
import { quoteBoxShellArg } from "./index.js";
import { BoxSubprocessHandle } from "./process.js";
import { spawnBoxTerminal } from "./terminal.js";

/** Configuration for the Upstash Box subprocess adapter. */
export interface Config {
  /** Reserved for future tuning; the session transport needs no polling. */
  readonly _?: never;
}

/**
 * Enforce the seam's documented grace bound (positive, finite, one Node timer),
 * matching subprocess-local's spawn-time check.
 * @param graceMs - The spec's cleanup grace in milliseconds.
 */
function requireRepresentableGrace(graceMs: number): void {
  if (!Number.isFinite(graceMs) || graceMs <= 0 || graceMs > MAX_TIMER_DELAY_MS) {
    throw new Error(
      `subprocess graceMs must be a positive finite number no greater than ${MAX_TIMER_DELAY_MS}`,
    );
  }
}

/**
 * Coerce a rejection into an Error without risking a useless "[object Object]".
 * @param value - The rejection reason.
 * @returns an Error carrying the reason.
 */
function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(inspect(value));
}

/** Upstash Box process manager registered as `ctx.subprocess`. */
export class BoxSubprocessRuntime extends SubprocessRuntime {
  static inject = ["box"];

  static Config: z<Config> = z.object({});

  private readonly live = new Set<BoxSubprocessHandle>();
  private readonly terminals = new Set<SubprocessTerminalHandle>();
  /** Allocations not yet in `terminals`; disposal must not race past them. */
  private readonly terminalSetups = new Set<Promise<unknown>>();
  private disposing = false;

  /** Create the Box subprocess service and bind its disposal policy. */
  constructor(ctx: Context, _config: Config) {
    super(ctx);
    ctx.effect(
      () => async () => {
        this.disposing = true;
        // A setup still awaiting getBox()/spawnBoxTerminal is not in `terminals`
        // yet, so snapshotting first would let the owner delete the box out from
        // under an allocation that is still running.
        await Promise.allSettled([...this.terminalSetups]);
        const handles = [...this.live];
        const terminals = [...this.terminals];
        // allSettled, not all: `all` rejects on the first failure while the
        // other cleanups are still running, so disposal would return early and
        // the owner could delete the shared box out from under a handle that is
        // still terminating. Every attempt settles first, then the failures are
        // reported together.
        const outcomes = await Promise.allSettled([
          ...handles.map(async (handle) => {
            handle.terminate();
            await handle.waitForExit();
            handle.close();
            this.live.delete(handle);
          }),
          ...terminals.map(async (terminal) => {
            await terminal.terminate();
            this.terminals.delete(terminal);
          }),
        ]);
        const failures = outcomes.flatMap<unknown>((outcome) =>
          outcome.status === "rejected" ? [outcome.reason as unknown] : [],
        );
        if (failures.length === 1) throw asError(failures[0]);
        if (failures.length > 1) {
          throw new AggregateError(failures.map(asError), "subprocess-box: teardown failed");
        }
      },
      "box subprocess teardown",
    );
  }

  /** @inheritdoc */
  async resolveExecutable(
    command: string,
    env?: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<string> {
    if (command.length === 0) throw new Error("subprocess-box: executable name must be non-empty");
    signal?.throwIfAborted();
    const box = await this.ctx.box.getBox();
    if (posix.isAbsolute(command)) {
      const probe = await box.exec.command(
        `test -f ${quoteBoxShellArg(command)} -a -x ${quoteBoxShellArg(command)} && echo ok`,
      );
      signal?.throwIfAborted();
      if (probe.result.trim() !== "ok") {
        throw new Error(`subprocess-box: ${JSON.stringify(command)} is not an executable file`);
      }
      return command;
    }
    if (command.includes("/")) {
      throw new Error(
        `subprocess-box: command ${JSON.stringify(command)} is a relative path; use an absolute path or a bare PATH name`,
      );
    }
    const path = env?.PATH;
    const prefix = path === undefined ? "" : `PATH=${quoteBoxShellArg(path)} `;
    const result = await box.exec.command(
      `cd ${quoteBoxShellArg(this.ctx.box.cwd)} && ${prefix}command -v -- ${quoteBoxShellArg(command)}`,
    );
    signal?.throwIfAborted();
    const executable = result.result.trim();
    if (
      executable.length === 0 ||
      executable.includes("\n") ||
      (!posix.isAbsolute(executable) && !executable.includes("/"))
    ) {
      throw new Error(
        `subprocess-box: executable ${JSON.stringify(command)} did not resolve to one absolute path`,
      );
    }
    // A relative result comes from a relative PATH entry; the lookup ran with the shared cwd.
    return posix.resolve(this.ctx.box.cwd, executable);
  }

  /** @inheritdoc */
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    if (this.disposing) throw new Error("subprocess-box: service is disposing");
    const program = spec.argv[0];
    if (program === undefined || program.length === 0) {
      throw new Error("invalid argv: expected a non-empty program name at argv[0]");
    }
    requireRepresentableGrace(spec.graceMs);
    if (spec.signal?.aborted === true) {
      throw new Error(`aborted before spawn: ${String(spec.signal.reason)}`);
    }
    const handle = new BoxSubprocessHandle(this.ctx.box, spec);
    this.live.add(handle);
    const release = (): void => {
      this.live.delete(handle);
    };
    void handle.done.then(release, release);
    return handle;
  }

  /** @inheritdoc */
  async spawnTerminal(spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    if (this.disposing) throw new Error("subprocess-box: service is disposing");
    const program = spec.argv[0];
    if (program === undefined || program.length === 0) {
      throw new Error("subprocess-box: terminal argv must contain a program");
    }
    requireRepresentableGrace(spec.graceMs);
    // Non-finite or fractional dimensions do not survive the exec-session
    // request intact, so the PTY would be created at a size the spec never
    // asked for.
    if (
      !Number.isSafeInteger(spec.rows) ||
      spec.rows <= 0 ||
      !Number.isSafeInteger(spec.cols) ||
      spec.cols <= 0
    ) {
      throw new Error("subprocess-box: terminal rows and cols must be positive integers");
    }
    spec.signal?.throwIfAborted();

    const setup = (async (): Promise<SubprocessTerminalHandle> => {
      const box = await this.ctx.box.getBox();
      return await spawnBoxTerminal(box, spec);
    })();
    this.terminalSetups.add(setup);
    let terminal: SubprocessTerminalHandle;
    try {
      terminal = await setup;
    } finally {
      this.terminalSetups.delete(setup);
    }
    // Remote allocation yields to disposal, so a terminal published after
    // teardown began is torn down rather than leaked.
    if (this.disposing) {
      await terminal.terminate();
      throw new Error("subprocess-box: service disposed during terminal setup");
    }
    this.terminals.add(terminal);
    const release = (): void => {
      this.terminals.delete(terminal);
    };
    void terminal.done.then(release, release);
    return terminal;
  }
}

export default BoxSubprocessRuntime;
