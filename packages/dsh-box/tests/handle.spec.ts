import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import type { ExecSessionHandle, ExecSessionOptions } from "@upstash/box";
import type { SubprocessSpawnSpec } from "@deepseek-ai/dsh-subprocess";
import { BoxSubprocessHandle } from "../src/process.js";

/**
 * State transitions of a live handle, driven by a fake session.
 *
 * These paths — handshake failure, abort, pre-handshake input, stream
 * settlement, cleanup — otherwise run only behind the credential-gated live
 * suite, so a regression in them would reach a release through green CI.
 */

interface FakeSession extends ExecSessionHandle {
  emitStdout(text: string): void;
  emitStderr(text: string): void;
  exit(code: number): void;
  readonly writes: string[];
  readonly stdinEnded: () => boolean;
  readonly terminated: () => number | undefined;
  readonly closed: () => boolean;
}

function fakeSession(pid = 4242): FakeSession {
  let onStdout: ((data: Uint8Array) => void) | undefined;
  let onStderr: ((data: Uint8Array) => void) | undefined;
  let settle: ((code: number) => void) | undefined;
  const exitPromise = new Promise<number>((resolve) => {
    settle = resolve;
  });
  const writes: string[] = [];
  let ended = false;
  let grace: number | undefined;
  let closedFlag = false;

  const session = {
    pid,
    execId: "exec-fake",
    write: (data: string | Uint8Array) => {
      writes.push(typeof data === "string" ? data : Buffer.from(data).toString());
    },
    endStdin: () => {
      ended = true;
    },
    resize: () => {},
    kill: () => {},
    terminate: (graceMs?: number) => {
      grace = graceMs ?? 0;
    },
    wait: () => exitPromise,
    close: () => {
      closedFlag = true;
    },
    emitStdout: (text: string) => onStdout?.(new Uint8Array(Buffer.from(text))),
    emitStderr: (text: string) => onStderr?.(new Uint8Array(Buffer.from(text))),
    exit: (code: number) => settle?.(code),
    writes,
    stdinEnded: () => ended,
    terminated: () => grace,
    closed: () => closedFlag,
  } as unknown as FakeSession;

  // The adapter registers its callbacks when the session opens.
  (session as unknown as { attach: (options: ExecSessionOptions) => void }).attach = (options) => {
    onStdout = options.onStdout;
    onStderr = options.onStderr;
  };
  return session;
}

/** An owner whose box hands back the fake session. */
function ownerFor(session: FakeSession | undefined, sessionError?: Error) {
  return {
    getBox: () =>
      Promise.resolve({
        exec: {
          session: (options: ExecSessionOptions) => {
            if (sessionError !== undefined) return Promise.reject(sessionError);
            (session as unknown as { attach: (o: ExecSessionOptions) => void }).attach(options);
            return Promise.resolve(session as unknown as ExecSessionHandle);
          },
        },
      }),
  } as never;
}

function spec(overrides: Partial<SubprocessSpawnSpec> = {}): SubprocessSpawnSpec {
  return {
    argv: ["/bin/echo", "hi"],
    cwd: "/workspace/home",
    stdio: { stdin: "ignore", stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } },
    graceMs: 500,
    env: {},
    ...overrides,
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("BoxSubprocessHandle", () => {
  it("constructs on every supported Node version", () => {
    // Guards the deferred helper: Promise.withResolvers is Node 22+, while this
    // package supports Node 18, so construction must not depend on it.
    const handle = new BoxSubprocessHandle(ownerFor(fakeSession()), spec());
    expect(handle.pid).toBe(-1);
    expect(handle.done).toBeInstanceOf(Promise);
  });

  it("publishes the pid and collected output once the session settles", async () => {
    const session = fakeSession(7301);
    const handle = new BoxSubprocessHandle(ownerFor(session), spec());
    await flush();
    expect(handle.pid).toBe(7301);

    session.emitStdout("out");
    session.emitStderr("err");
    session.exit(3);
    await expect(handle.done).resolves.toEqual({ exitCode: 3, signal: null });
    expect(handle.collected.stdout?.readFrom(0).text).toBe("out");
    expect(handle.collected.stderr?.readFrom(0).text).toBe("err");
  });

  it("rejects done when the session never opens", async () => {
    const handle = new BoxSubprocessHandle(
      ownerFor(undefined, new Error("handshake refused")),
      spec(),
    );
    await expect(handle.done).rejects.toThrow(/handshake refused/);
  });

  it("closes stdin for an ignore disposition and writes batch data", async () => {
    const session = fakeSession();
    const handle = new BoxSubprocessHandle(
      ownerFor(session),
      spec({
        stdio: { stdin: { data: "in" }, stdout: { maxBytes: 16 }, stderr: { maxBytes: 16 } },
      }),
    );
    await flush();
    expect(session.writes).toEqual(["in"]);
    expect(session.stdinEnded()).toBe(true);
    session.exit(0);
    await handle.done;
  });

  it("queues piped stdin written before the handshake completes", async () => {
    const session = fakeSession();
    const handle = new BoxSubprocessHandle(
      ownerFor(session),
      spec({ stdio: { stdin: "pipe", stdout: { maxBytes: 16 }, stderr: { maxBytes: 16 } } }),
    );
    handle.stdin?.write("early");
    expect(session.writes).toEqual([]);
    await flush();
    expect(session.writes).toEqual(["early"]);
    session.exit(0);
    await handle.done;
  });

  it("terminates when the spec's signal aborts, and drops the listener after exit", async () => {
    const controller = new AbortController();
    const session = fakeSession();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const handle = new BoxSubprocessHandle(ownerFor(session), spec({ signal: controller.signal }));
    await flush();
    controller.abort();
    expect(session.terminated()).toBe(500);
    session.exit(143);
    await handle.done;
    // A shared controller must not retain completed handles.
    expect(remove).toHaveBeenCalled();
  });

  it("carries a requested termination raised before the handshake", async () => {
    const session = fakeSession();
    const handle = new BoxSubprocessHandle(ownerFor(session), spec());
    handle.terminate();
    await flush();
    expect(session.terminated()).toBe(500);
    session.exit(137);
    await expect(handle.done).resolves.toEqual({ exitCode: null, signal: "SIGKILL" });
  });

  it("ends piped streams when the process exits", async () => {
    const session = fakeSession();
    const handle = new BoxSubprocessHandle(
      ownerFor(session),
      spec({ stdio: { stdin: "ignore", stdout: "pipe", stderr: "pipe" } }),
    );
    await flush();
    const chunks: string[] = [];
    handle.stdout?.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    const ended = new Promise((resolve) => handle.stdout?.on("end", resolve));
    session.emitStdout("streamed");
    session.exit(0);
    await handle.done;
    await ended;
    expect(chunks.join("")).toBe("streamed");
  });

  it("waitForExit resolves false when its signal aborts first", async () => {
    const session = fakeSession();
    const handle = new BoxSubprocessHandle(ownerFor(session), spec());
    await flush();
    const controller = new AbortController();
    const waiting = handle.waitForExit(controller.signal);
    controller.abort();
    await expect(waiting).resolves.toBe(false);
    session.exit(0);
    await handle.done;
  });
});
