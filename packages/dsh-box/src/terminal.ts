/**
 * One terminal session running inside the shared Upstash Box.
 *
 * A Box exec session already carries the PTY: `tty` allocates one sized by
 * `rows`/`cols` at exec-create, so the terminal is correct from its first read
 * and needs no post-hoc resize. Foreground-group inspection and signalling are
 * not part of the session protocol, so they run as short probes in the box.
 */

import { Buffer } from "node:buffer";
import { Readable } from "node:stream";
import type { Box, ExecSessionHandle } from "@upstash/box";
import { quoteBoxShellArg } from "./index.js";
import type {
  SubprocessOutcome,
  SubprocessTerminalForeground,
  SubprocessTerminalHandle,
  SubprocessTerminalSignal,
  SubprocessTerminalSpawnSpec,
} from "@deepseek-ai/dsh-subprocess";
import { deferred, type Deferred } from "./deferred.js";
import { argvWithRemovals, removedEnvNames, sessionEnv } from "./process.js";

/**
 * Read the terminal's foreground process group from the session leader.
 *
 * `/proc/<pid>/stat` holds `tpgid` after the comm field, which can itself
 * contain spaces and parentheses, so the comm is stripped before the fields are
 * split. `wchan` names the kernel function a process is parked in, which is the
 * only stdin-wait evidence the substrate exposes. Only a tty *read* counts: a
 * process parked in a tty write is blocked on output backpressure, which is not
 * what the seam means by waiting for input.
 */
function foregroundProbe(pid: number): string {
  return [
    `tp=$(awk '{sub(/.*\\) /, ""); print $6}' /proc/${pid}/stat 2>/dev/null)`,
    '[ -z "$tp" ] && { echo "none"; exit 0; }',
    "w=0",
    "for d in /proc/[0-9]*; do",
    '  pg=$(awk \'{sub(/.*\\) /, ""); print $3}\' "$d/stat" 2>/dev/null)',
    '  [ "$pg" = "$tp" ] || continue',
    '  case "$(cat "$d/wchan" 2>/dev/null)" in *tty_read*) w=1 ;; esac',
    "done",
    'echo "$tp $w"',
  ].join("\n");
}

/**
 * Await `pending`, but stop waiting if `signal` aborts first.
 *
 * The abort does not cancel the underlying request, so a value that arrives
 * afterwards is handed to `cleanup` rather than leaked.
 * @param pending - the operation to await.
 * @param signal - the caller's cancellation, when supplied.
 * @param cleanup - disposes a value that arrives after the abort.
 * @returns the value, when it wins the race.
 */
async function raceAbort<T>(
  pending: Promise<T>,
  signal: AbortSignal | undefined,
  cleanup: (value: T) => void,
): Promise<T> {
  if (signal === undefined) return await pending;
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(signal.reason ?? new Error("dsh-box: terminal allocation aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) onAbort();
  });
  try {
    return await Promise.race([pending, aborted]);
  } catch (error: unknown) {
    void pending.then(cleanup, () => undefined);
    throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/** A live Box-backed terminal exposed through the subprocess seam. */
export class BoxTerminalHandle implements SubprocessTerminalHandle {
  /** @inheritdoc */
  readonly pid: number;
  /** @inheritdoc */
  readonly output: Readable;
  /** @inheritdoc */
  readonly done: Promise<SubprocessOutcome>;

  private exited = false;
  private closing = false;
  private readonly inFlight = new Set<Promise<unknown>>();
  private settlement: Promise<void> | undefined;
  private readonly settled: Deferred<SubprocessOutcome>;

  constructor(
    private readonly box: Box,
    private readonly session: ExecSessionHandle,
    private readonly graceMs: number,
    output: Readable,
  ) {
    this.pid = session.pid;
    this.output = output;
    this.settled = deferred<SubprocessOutcome>();
    this.done = this.settled.promise;
    // A transport failure rejects `done`; keep that observed so an unwatched
    // terminal cannot take the process down with an unhandled rejection.
    void this.done.catch(() => undefined);

    void session
      .wait()
      .then((code) => {
        this.finish(code);
      })
      .catch(() => {
        this.finish(-1);
      });
  }

  private finish(code: number): void {
    if (this.exited) return;
    this.exited = true;
    this.output.push(null);
    // The SDK reports -1 when a live session's connection closes or errors; a
    // real exit always carries its code. Reporting that as a successful outcome
    // would make a lost terminal indistinguishable from a clean one.
    if (code === -1) {
      this.settled.reject(new Error("dsh-box: terminal session ended without an exit code"));
      return;
    }
    // Same as the process handle: a requested teardown does not prove which
    // signal produced this code, since an application can catch SIGTERM and
    // exit 143 or 137 itself. Preserve the server's exit code rather than
    // inventing a signal fact the protocol never supplied.
    this.settled.resolve({ exitCode: code, signal: null });
  }

  /**
   * Run one terminal operation, unless teardown has begun.
   *
   * The seam requires that no write, inspection, or signal remains in flight
   * once `terminate()` settles, so operations are both gated and tracked.
   */
  private async operation<T>(run: () => Promise<T>): Promise<T> {
    if (this.closing) throw new Error("dsh-box: terminal session is terminating");
    const pending = run();
    this.inFlight.add(pending);
    try {
      return await pending;
    } finally {
      this.inFlight.delete(pending);
    }
  }

  /** @inheritdoc */
  async write(data: string): Promise<void> {
    if (this.exited) return;
    await this.operation(async () => {
      this.session.write(data);
    });
  }

  /** @inheritdoc */
  async inspectForeground(): Promise<SubprocessTerminalForeground | undefined> {
    if (this.exited || this.closing) return undefined;
    const probe = await this.operation(() => this.box.exec.command(foregroundProbe(this.pid)));
    const [group, waiting] = probe.result.trim().split(/\s+/);
    if (group === undefined || group === "none") return undefined;
    const processGroupId = Number(group);
    // A group id of 0 or 1 is not a terminal foreground this adapter can act on.
    if (!Number.isSafeInteger(processGroupId) || processGroupId <= 1) return undefined;
    return { processGroupId, inputWaiting: waiting === "1" };
  }

  /** @inheritdoc */
  async signalForeground(signal: SubprocessTerminalSignal): Promise<number> {
    const foreground = await this.inspectForeground();
    if (foreground === undefined) {
      throw new Error("dsh-box: no foreground process group to signal");
    }
    // Negating the group id targets the whole group, matching a real terminal's
    // signal delivery rather than only its leader.
    // The signal union is closed, so this is not injectable today; quoting keeps
    // that from depending on the union staying closed.
    const name = quoteBoxShellArg(signal.replace(/^SIG/, ""));
    const delivery = await this.operation(() =>
      this.box.exec.command(`kill -s ${name} -- -${foreground.processGroupId}`),
    );
    // exec.command resolves for a nonzero exit, so the exit code is the only
    // evidence of delivery. A group that exited between inspection and the
    // signal must not be reported as having received it.
    if (delivery.exitCode !== 0) {
      throw new Error(
        `dsh-box: failed to signal foreground process group ${foreground.processGroupId}: ${delivery.result.trim()}`,
      );
    }
    return foreground.processGroupId;
  }

  /** @inheritdoc */
  async terminate(): Promise<void> {
    this.settlement ??= this.stop();
    await this.settlement;
  }

  private async stop(): Promise<void> {
    // Gate first: nothing new may start once teardown has begun.
    this.closing = true;
    if (!this.exited) this.session.terminate(this.graceMs);
    await this.done.catch(() => undefined);
    // Drain what was already running, so the contract's "nothing in flight
    // after settlement" holds and no probe races the owner deleting the box.
    await Promise.allSettled([...this.inFlight]);
    this.session.close();
  }
}

/**
 * Open one terminal session in the box.
 * @param box - the shared SDK handle.
 * @param spec - the fully specified terminal spawn.
 * @returns a published handle whose PTY is already sized.
 */
export async function spawnBoxTerminal(
  box: Box,
  spec: SubprocessTerminalSpawnSpec,
): Promise<SubprocessTerminalHandle> {
  const output = new Readable({ read() {} });
  const opening = box.exec.session({
    argv: argvWithRemovals(spec.argv, removedEnvNames(spec.env)),
    cwd: spec.cwd,
    env: sessionEnv(spec.env),
    tty: true,
    rows: spec.rows,
    cols: spec.cols,
    // A TTY merges stderr into stdout, so one callback carries the terminal.
    onStdout: (data) => {
      output.push(Buffer.from(data));
    },
  });
  // `signal` cancels allocation. The SDK's handshake takes no abort, so waiting
  // on it alone would ignore an abort for the whole request timeout; race it
  // instead and tear down a session that lands after we stop waiting.
  const session = await raceAbort(opening, spec.signal, (late) => {
    late.terminate(spec.graceMs);
    late.close();
  });
  return new BoxTerminalHandle(box, session, spec.graceMs, output);
}
