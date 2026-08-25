/**
 * Upstash Box Service Provider for the subprocess capability seam. Each handle
 * is one live exec session in the shared box: the session owns the process
 * tree, so losing it stops the work rather than orphaning it.
 * @module @upstash/dsh-box/subprocess
 */

import { posix } from "node:path";
import { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
// The published 0.0.1-rc.1 exports this base class as SubprocessService; the
// harness renamed it to SubprocessRuntime after that release. Alias it so the
// rename is one line to change when a newer rc lands.
import { SubprocessService as SubprocessRuntime } from "@deepseek-ai/dsh-subprocess";
import { MAX_TIMER_DELAY_MS } from "@deepseek-ai/dsh-timeout";
import type {
  SubprocessHandle,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from "@deepseek-ai/dsh-subprocess";
import { quoteBoxShellArg } from "./index.js";
import { BoxSubprocessHandle } from "./process.js";

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

/** Upstash Box process manager registered as `ctx.subprocess`. */
export class BoxSubprocessRuntime extends SubprocessRuntime {
  static inject = ["box"];

  static Config: z<Config> = z.object({});

  private readonly live = new Set<BoxSubprocessHandle>();
  private disposing = false;

  /** Create the Box subprocess service and bind its disposal policy. */
  constructor(ctx: Context, _config: Config) {
    super(ctx);
    ctx.effect(
      () => async () => {
        this.disposing = true;
        const handles = [...this.live];
        await Promise.all(
          handles.map(async (handle) => {
            handle.terminate();
            await handle.waitForExit();
            handle.close();
            this.live.delete(handle);
          }),
        );
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
    if (spec.stdio.stdout === "inherit" || spec.stdio.stderr === "inherit") {
      throw new Error(
        "subprocess-box: inherit output is not implemented in this phase; use pipe or collect",
      );
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
  spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    // exec.session already carries tty/rows/cols and the PTY was verified end to
    // end; wiring it to the terminal seam is the next phase, not a missing primitive.
    return Promise.reject(
      new Error("subprocess-box: spawnTerminal is not implemented in this phase"),
    );
  }
}

export default BoxSubprocessRuntime;
