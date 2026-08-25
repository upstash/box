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

  it("holds piped stdin until the handshake completes, then delivers it", async () => {
    const session = fakeSession();
    const handle = new BoxSubprocessHandle(
      ownerFor(session),
      spec({ stdio: { stdin: "pipe", stdout: { maxBytes: 16 }, stderr: { maxBytes: 16 } } }),
    );
    let acknowledged = false;
    handle.stdin?.write("early", () => {
      acknowledged = true;
    });
    // The write callback stays pending, which is what applies the stream's high
    // water mark: without it a producer could enqueue unbounded input during a
    // slow handshake.
    expect(acknowledged).toBe(false);
    expect(session.writes).toEqual([]);
    await flush();
    await flush();
    expect(session.writes).toEqual(["early"]);
    expect(acknowledged).toBe(true);
    session.exit(0);
    await handle.done;
  });

  it("fails pending stdin writes when the handshake fails", async () => {
    const handle = new BoxSubprocessHandle(
      ownerFor(undefined, new Error("handshake refused")),
      spec({ stdio: { stdin: "pipe", stdout: { maxBytes: 16 }, stderr: { maxBytes: 16 } } }),
    );
    // Failing a write callback destroys the Writable and emits "error", which
    // is the stream contract a piped consumer has to honour; without a listener
    // Node escalates it to an uncaught exception.
    const streamError = new Promise<Error>((resolve) => {
      handle.stdin?.on("error", resolve);
    });
    const failed = new Promise<Error | null | undefined>((resolve) => {
      handle.stdin?.write("doomed", resolve);
    });
    await expect(failed).resolves.toBeInstanceOf(Error);
    expect((await streamError).message).toMatch(/handshake refused/);
    await expect(handle.done).rejects.toThrow(/handshake refused/);
  });

  it("rejects done when the session ends without an exit code", async () => {
    const session = fakeSession();
    const handle = new BoxSubprocessHandle(ownerFor(session), spec());
    await flush();
    // -1 is the SDK's lost-connection signal, not a process outcome.
    session.exit(-1);
    await expect(handle.done).rejects.toThrow(/without an exit code/);
  });

  it("cancels without replaying queued input", async () => {
    const session = fakeSession();
    const handle = new BoxSubprocessHandle(
      ownerFor(session),
      spec({
        stdio: { stdin: { data: "work" }, stdout: { maxBytes: 16 }, stderr: { maxBytes: 16 } },
      }),
    );
    handle.terminate();
    await flush();
    // Delivering the batch first would let the command act on input it was
    // already cancelled for.
    expect(session.writes).toEqual([]);
    expect(session.terminated()).toBe(500);
    session.exit(143);
    await expect(handle.done).resolves.toEqual({ exitCode: null, signal: "SIGTERM" });
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

  it("does not name a signal termination never delivered", async () => {
    const session = fakeSession();
    const handle = new BoxSubprocessHandle(ownerFor(session), spec());
    handle.terminate();
    await flush();
    // Terminate sends TERM then KILL. A TERM handler that exits 130 is an exit
    // code, not an interrupt this adapter delivered.
    session.exit(130);
    await expect(handle.done).resolves.toEqual({ exitCode: 130, signal: null });
  });

  it("removes the waitForExit listener once its race settles", async () => {
    const session = fakeSession();
    const handle = new BoxSubprocessHandle(ownerFor(session), spec());
    await flush();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const waiting = handle.waitForExit(controller.signal);
    session.exit(0);
    await expect(waiting).resolves.toBe(true);
    // `done` won the race, so the listener has to come off anyway: a long-lived
    // signal reused across bounded waits would otherwise retain one per call.
    expect(remove).toHaveBeenCalled();
  });

  it("resolves waitForExit false when the signal is already aborted", async () => {
    const session = fakeSession();
    const handle = new BoxSubprocessHandle(ownerFor(session), spec());
    await flush();
    const controller = new AbortController();
    controller.abort();
    await expect(handle.waitForExit(controller.signal)).resolves.toBe(false);
    session.exit(0);
    await handle.done;
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

  it("writes inherit output to the harness streams without touching CI logs", async () => {
    const session = fakeSession();
    // Spying rather than letting it through keeps the bytes out of the test log
    // while still proving where they were routed.
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    try {
      const handle = new BoxSubprocessHandle(
        ownerFor(session),
        spec({ stdio: { stdin: "ignore", stdout: "inherit", stderr: "inherit" } }),
      );
      await flush();
      session.emitStdout("to-stdout");
      session.emitStderr("to-stderr");
      session.exit(0);
      await handle.done;

      expect(out.mock.calls.map(([chunk]) => String(chunk)).join("")).toBe("to-stdout");
      expect(err.mock.calls.map(([chunk]) => String(chunk)).join("")).toBe("to-stderr");
      // inherit is not collected, so no reader is exposed for it.
      expect(handle.collected.stdout).toBeUndefined();
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
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

describe("BoxRuntime config validation", () => {
  it("rejects a timeout Node's timers cannot represent", async () => {
    const { Context } = await import("@deepseek-ai/cordis");
    const BoxRuntime = (await import("../src/index.js")).default;
    const ctx = new Context();
    // Node clamps a delay above the maximum to 1ms, so an over-large timeout
    // would abort requests immediately instead of waiting.
    await expect(
      ctx.plugin(BoxRuntime, { apiKey: "box_test", requestTimeoutMs: 2_147_483_648 }),
    ).rejects.toThrow(/no greater than 2147483647/);
    await expect(
      ctx.plugin(BoxRuntime, { apiKey: "box_test", requestTimeoutMs: 0 }),
    ).rejects.toThrow(/positive finite number/);
  });
});

describe("terminal spawn validation", () => {
  it("rejects dimensions that are not positive safe integers", async () => {
    const { Context } = await import("@deepseek-ai/cordis");
    const BoxSubprocessRuntime = (await import("../src/subprocess.js")).default;
    const ctx = new Context();
    ctx.provide("box", { cwd: "/workspace/home", getBox: () => Promise.resolve({}) } as never);
    await ctx.plugin(BoxSubprocessRuntime, {});
    const base = {
      argv: ["/bin/bash"],
      cwd: "/workspace/home",
      graceMs: 500,
      env: {},
    };
    for (const dims of [
      { rows: Number.NaN, cols: 80 },
      { rows: Number.POSITIVE_INFINITY, cols: 80 },
      { rows: 24.5, cols: 80 },
      { rows: 24, cols: 0 },
    ]) {
      await expect(ctx.subprocess.spawnTerminal({ ...base, ...dims })).rejects.toThrow(
        /positive integers/,
      );
    }
  });
});

describe("service disposal", () => {
  it("waits for every cleanup even when one of them throws", async () => {
    const { Context } = await import("@deepseek-ai/cordis");
    const BoxSubprocessRuntime = (await import("../src/subprocess.js")).default;

    const failing = fakeSession(11);
    const slow = fakeSession(22);
    // The failing handle rejects immediately; the sibling takes a moment to
    // exit. Promise.all would settle on the rejection and let disposal return
    // while the sibling was still terminating, so the timing is the test.
    const failFast = failing.terminate.bind(failing);
    (failing as unknown as { terminate: (graceMs?: number) => void }).terminate = (graceMs) => {
      failFast(graceMs);
      failing.exit(143);
    };
    (failing as unknown as { close: () => void }).close = () => {
      throw new Error("close blew up");
    };
    const recordSlow = slow.terminate.bind(slow);
    (slow as unknown as { terminate: (graceMs?: number) => void }).terminate = (graceMs) => {
      recordSlow(graceMs);
      setTimeout(() => {
        slow.exit(143);
      }, 25);
    };

    const sessions = [failing, slow];
    const ctx = new Context();
    ctx.provide("box", {
      cwd: "/workspace/home",
      getBox: () =>
        Promise.resolve({
          exec: {
            session: (options: ExecSessionOptions) => {
              const next = sessions.shift();
              if (next === undefined) throw new Error("no session left");
              (next as unknown as { attach: (o: ExecSessionOptions) => void }).attach(options);
              return Promise.resolve(next as unknown as ExecSessionHandle);
            },
          },
        }),
    } as never);
    const fiber = await ctx.plugin(BoxSubprocessRuntime, {});

    ctx.subprocess.spawn(spec());
    ctx.subprocess.spawn(spec());
    await flush();

    await fiber.dispose().catch(() => undefined);

    // Disposal returned only after the slow sibling finished. If it had
    // returned early, the owner could delete the shared box while this handle
    // was still terminating.
    expect(slow.closed()).toBe(true);
  });
});
