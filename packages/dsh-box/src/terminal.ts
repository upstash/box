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

/** Exit codes a shell reports for a signalled death. */
const SIGNAL_EXIT_CODES: Readonly<Record<number, NodeJS.Signals>> = {
  130: "SIGINT",
  137: "SIGKILL",
  143: "SIGTERM",
};

/**
 * Read the terminal's foreground process group from the session leader.
 *
 * `/proc/<pid>/stat` holds `tpgid` after the comm field, which can itself
 * contain spaces and parentheses, so the comm is stripped before the fields are
 * split. `wchan` names the kernel function a process is parked in, which is the
 * only stdin-wait evidence the substrate exposes.
 */
function foregroundProbe(pid: number): string {
  return [
    `tp=$(awk '{sub(/.*\\) /, ""); print $6}' /proc/${pid}/stat 2>/dev/null)`,
    '[ -z "$tp" ] && { echo "none"; exit 0; }',
    "w=0",
    "for d in /proc/[0-9]*; do",
    '  pg=$(awk \'{sub(/.*\\) /, ""); print $3}\' "$d/stat" 2>/dev/null)',
    '  [ "$pg" = "$tp" ] || continue',
    '  case "$(cat "$d/wchan" 2>/dev/null)" in *tty_read*|*tty_write*) w=1 ;; esac',
    "done",
    'echo "$tp $w"',
  ].join("\n");
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
  private terminateRequested = false;
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
    // A 128+n code names a signal only when this adapter asked for the stop; the
    // escalation TERMs then KILLs, so either 143 or 137 is that requested stop.
    const signal = this.terminateRequested ? SIGNAL_EXIT_CODES[code] : undefined;
    this.settled.resolve(
      signal === undefined ? { exitCode: code, signal: null } : { exitCode: null, signal },
    );
  }

  /** @inheritdoc */
  async write(data: string): Promise<void> {
    if (this.exited) return;
    this.session.write(data);
    return Promise.resolve();
  }

  /** @inheritdoc */
  async inspectForeground(): Promise<SubprocessTerminalForeground | undefined> {
    if (this.exited) return undefined;
    const probe = await this.box.exec.command(foregroundProbe(this.pid));
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
    await this.box.exec.command(`kill -s ${name} -- -${foreground.processGroupId}`);
    return foreground.processGroupId;
  }

  /** @inheritdoc */
  async terminate(): Promise<void> {
    this.settlement ??= this.stop();
    await this.settlement;
  }

  private async stop(): Promise<void> {
    this.terminateRequested = true;
    if (!this.exited) this.session.terminate(this.graceMs);
    await this.done.catch(() => undefined);
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
  const session = await box.exec.session({
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
  const terminal = new BoxTerminalHandle(box, session, spec.graceMs, output);
  // `signal` cancels allocation, and allocation spans the awaits above. A signal
  // that fired in that window must not leave a published terminal running.
  if (spec.signal?.aborted === true) {
    await terminal.terminate();
    spec.signal.throwIfAborted();
  }
  return terminal;
}
