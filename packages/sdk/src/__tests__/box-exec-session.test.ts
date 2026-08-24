import { describe, it, expect, afterEach, vi } from "vitest";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";
import { Box } from "../client.js";
import { mockResponse } from "./helpers.js";

const b64 = (s: string) => Buffer.from(s).toString("base64");

/** Start a mock exec-session WebSocket server on an ephemeral port. */
async function startMockExecServer(
  onConnection: (ws: WsSocket) => void,
): Promise<{ wss: WebSocketServer; port: number }> {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((r) => wss.once("listening", () => r()));
  wss.on("connection", onConnection);
  const port = (wss.address() as { port: number }).port;
  return { wss, port };
}

/** A Box whose baseUrl points at the local mock server. */
async function boxForPort(port: number, timeout?: number): Promise<Box> {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(mockResponse({ id: "box-123", status: "running", runtime: "node" }))
    // Any later HTTP call (e.g. cd() -> POST /exec) succeeds; sessions use ws, not fetch.
    .mockResolvedValue(mockResponse({ exit_code: 0 }));
  vi.stubGlobal("fetch", fetchMock);
  return Box.get("box-123", { apiKey: "k", baseUrl: `http://127.0.0.1:${port}`, timeout });
}

/** Server that replies `started` then `exit 0` to any start frame. */
function trivialStart(onStart?: (frame: Record<string, unknown>) => void) {
  return (ws: WsSocket) => {
    ws.on("message", (raw) => {
      const f = JSON.parse(raw.toString());
      if (f.type === "start") {
        onStart?.(f);
        ws.send(JSON.stringify({ type: "started", pid: 1, execId: "e" }));
        ws.send(JSON.stringify({ type: "exit", code: 0 }));
      }
    });
  };
}

describe("Box exec.session (WebSocket)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("runs a non-TTY command: started -> stdout -> exit code", async () => {
    const { wss, port } = await startMockExecServer((ws) => {
      ws.on("message", (raw) => {
        const f = JSON.parse(raw.toString());
        if (f.type === "start") {
          ws.send(JSON.stringify({ type: "started", pid: 123, execId: "e1" }));
          ws.send(JSON.stringify({ type: "stdout", data: b64("hello\n") }));
          ws.send(JSON.stringify({ type: "exit", code: 7 }));
        }
      });
    });
    try {
      const box = await boxForPort(port);
      let out = "";
      const session = await box.exec.session({
        cmd: "echo hello",
        onStdout: (d) => (out += Buffer.from(d).toString()),
      });
      expect(session.pid).toBe(123);
      expect(session.execId).toBe("e1");
      expect(await session.wait()).toBe(7);
      expect(out).toBe("hello\n");
    } finally {
      wss.close();
    }
  });

  it("round-trips stdin and terminates on a signal frame", async () => {
    const { wss, port } = await startMockExecServer((ws) => {
      ws.on("message", (raw) => {
        const f = JSON.parse(raw.toString());
        if (f.type === "start") ws.send(JSON.stringify({ type: "started", pid: 5, execId: "e2" }));
        else if (f.type === "stdin")
          ws.send(JSON.stringify({ type: "stdout", data: f.data })); // echo
        else if (f.type === "signal") ws.send(JSON.stringify({ type: "exit", code: 137 }));
      });
    });
    try {
      const box = await boxForPort(port);
      let out = "";
      const s = await box.exec.session({
        argv: ["cat"],
        onStdout: (d) => (out += Buffer.from(d).toString()),
      });
      s.write("ping");
      await new Promise((r) => setTimeout(r, 50));
      expect(out).toBe("ping");
      s.kill("KILL");
      expect(await s.wait()).toBe(137);
    } finally {
      wss.close();
    }
  });

  it("sends argv (over cmd), tty, and dimensions in the start frame", async () => {
    let startFrame: Record<string, unknown> | undefined;
    const { wss, port } = await startMockExecServer((ws) => {
      ws.on("message", (raw) => {
        const f = JSON.parse(raw.toString());
        if (f.type === "start") {
          startFrame = f;
          ws.send(JSON.stringify({ type: "started", pid: 1, execId: "e" }));
          ws.send(JSON.stringify({ type: "exit", code: 0 }));
        }
      });
    });
    try {
      const box = await boxForPort(port);
      const s = await box.exec.session({
        cmd: "ignored",
        argv: ["ls", "-la"],
        tty: true,
        rows: 24,
        cols: 80,
      });
      await s.wait();
      expect(startFrame?.argv).toEqual(["ls", "-la"]);
      expect(startFrame?.cmd).toBeUndefined();
      expect(startFrame?.tty).toBe(true);
      expect(startFrame?.rows).toBe(24);
      expect(startFrame?.cols).toBe(80);
    } finally {
      wss.close();
    }
  });

  it("rejects when the server sends an error frame before start, and hangs up", async () => {
    let closed!: () => void;
    const serverSawClose = new Promise<void>((r) => (closed = r));
    const { wss, port } = await startMockExecServer((ws) => {
      ws.on("close", () => closed());
      ws.on("message", () => ws.send(JSON.stringify({ type: "error", message: "boom" })));
    });
    try {
      const box = await boxForPort(port);
      await expect(box.exec.session({ cmd: "x" })).rejects.toThrow(/boom/);
      // A rejected session must not leak its socket.
      await serverSawClose;
    } finally {
      wss.close();
    }
  });

  it("ends wait() and hangs up on an error frame after start", async () => {
    let closed!: () => void;
    const serverSawClose = new Promise<void>((r) => (closed = r));
    const { wss, port } = await startMockExecServer((ws) => {
      ws.on("close", () => closed());
      ws.on("message", (raw) => {
        if (JSON.parse(raw.toString()).type === "start") {
          ws.send(JSON.stringify({ type: "started", pid: 5, execId: "e" }));
          ws.send(JSON.stringify({ type: "error", message: "late boom" }));
        }
      });
    });
    try {
      const box = await boxForPort(port);
      const session = await box.exec.session({ cmd: "x" });
      expect(await session.wait()).toBe(-1);
      // Once wait() settles the caller considers the session over, so leaving
      // the connection open would keep the process alive in the box.
      await serverSawClose;
    } finally {
      wss.close();
    }
  });

  it.each([
    ["a zero pid", { type: "started", pid: 0, execId: "e" }],
    ["no pid at all", { type: "started", execId: "e" }],
  ])("rejects a started frame with %s", async (_label, startedFrame) => {
    const { wss, port } = await startMockExecServer((ws) => {
      ws.on("message", (raw) => {
        if (JSON.parse(raw.toString()).type === "start") ws.send(JSON.stringify(startedFrame));
      });
    });
    try {
      const box = await boxForPort(port);
      // A handle whose kill()/terminate() cannot reach the process is worse
      // than no handle, so the handshake fails instead.
      await expect(box.exec.session({ cmd: "x" })).rejects.toThrow(/without a usable pid/);
    } finally {
      wss.close();
    }
  });

  it.each(["stdout", "stderr"] as const)(
    "contains a throwing on%s callback instead of crashing the process",
    async (stream) => {
      const { wss, port } = await startMockExecServer((ws) => {
        ws.on("message", (raw) => {
          if (JSON.parse(raw.toString()).type === "start") {
            ws.send(JSON.stringify({ type: "started", pid: 3, execId: "e" }));
            ws.send(JSON.stringify({ type: stream, data: b64("boom\n") }));
          }
        });
      });
      try {
        const box = await boxForPort(port);
        const thrower = () => {
          throw new Error("callback blew up");
        };
        const session = await box.exec.session({
          cmd: "x",
          ...(stream === "stdout" ? { onStdout: thrower } : { onStderr: thrower }),
        });
        // The throw must not escape the ws listener as an uncaught exception;
        // the session ends instead so the host process survives.
        expect(await session.wait()).toBe(-1);
      } finally {
        wss.close();
      }
    },
  );

  it("rejects locally (no socket) when neither cmd nor argv is given", async () => {
    const box = await boxForPort(0); // port unused; must reject before connecting
    await expect(box.exec.session({})).rejects.toThrow(/requires cmd or argv/);
    await expect(box.exec.session({ cmd: "" })).rejects.toThrow(/requires cmd or argv/);
  });

  it("defaults cwd to the box cwd (honoring cd) and resolves an explicit cwd", async () => {
    let frame: Record<string, unknown> | undefined;
    const { wss, port } = await startMockExecServer(trivialStart((f) => (frame = f)));
    try {
      const box = await boxForPort(port);
      await box.cd("src");
      await (await box.exec.session({ cmd: "pwd" })).wait();
      expect(frame?.cwd).toBe("/workspace/home/src");

      await (await box.exec.session({ cmd: "pwd", cwd: "nested" })).wait();
      expect(frame?.cwd).toBe("/workspace/home/src/nested");
    } finally {
      wss.close();
    }
  });

  it("delivers stderr and forwards resize frames", async () => {
    let resizeFrame: Record<string, unknown> | undefined;
    const { wss, port } = await startMockExecServer((ws) => {
      ws.on("message", (raw) => {
        const f = JSON.parse(raw.toString());
        if (f.type === "start") {
          ws.send(JSON.stringify({ type: "started", pid: 1, execId: "e" }));
          ws.send(JSON.stringify({ type: "stderr", data: b64("oops\n") }));
        } else if (f.type === "resize") {
          resizeFrame = f;
          ws.send(JSON.stringify({ type: "exit", code: 0 }));
        }
      });
    });
    try {
      const box = await boxForPort(port);
      let err = "";
      const s = await box.exec.session({
        tty: true,
        cmd: "x",
        onStderr: (d) => (err += Buffer.from(d).toString()),
      });
      await new Promise((r) => setTimeout(r, 30));
      expect(err).toBe("oops\n");
      s.resize(30, 100);
      await s.wait();
      expect(resizeFrame).toMatchObject({ rows: 30, cols: 100 });
    } finally {
      wss.close();
    }
  });

  it("close() ends the session (wait resolves)", async () => {
    const { wss, port } = await startMockExecServer((ws) => {
      ws.on("message", (raw) => {
        const f = JSON.parse(raw.toString());
        if (f.type === "start") ws.send(JSON.stringify({ type: "started", pid: 1, execId: "e" }));
        // never sends exit; client close() must settle wait()
      });
    });
    try {
      const box = await boxForPort(port);
      const s = await box.exec.session({ cmd: "sleep 999" });
      s.close();
      expect(await s.wait()).toBe(-1);
    } finally {
      wss.close();
    }
  });

  it("kill() rejects a signal outside the allowlist", async () => {
    const { wss, port } = await startMockExecServer((ws) => {
      ws.on("message", (raw) => {
        const f = JSON.parse(raw.toString());
        if (f.type === "start") ws.send(JSON.stringify({ type: "started", pid: 1, execId: "e" }));
      });
    });
    try {
      const box = await boxForPort(port);
      const s = await box.exec.session({ cmd: "sleep 999" });
      expect(() => s.kill("BOGUS")).toThrow(/unsupported signal/);
      expect(() => s.kill("SIGKILL")).not.toThrow();
      s.close();
    } finally {
      wss.close();
    }
  });

  it("endStdin() sends a stdin_close frame; the process exits on EOF (no kill)", async () => {
    const { wss, port } = await startMockExecServer((ws) => {
      ws.on("message", (raw) => {
        const f = JSON.parse(raw.toString());
        if (f.type === "start") ws.send(JSON.stringify({ type: "started", pid: 1, execId: "e" }));
        else if (f.type === "stdin") ws.send(JSON.stringify({ type: "stdout", data: f.data }));
        else if (f.type === "stdin_close") ws.send(JSON.stringify({ type: "exit", code: 0 }));
      });
    });
    try {
      const box = await boxForPort(port);
      let out = "";
      const s = await box.exec.session({
        argv: ["cat"],
        onStdout: (d) => (out += Buffer.from(d).toString()),
      });
      s.write("hi\n");
      await new Promise((r) => setTimeout(r, 30));
      s.endStdin();
      expect(await s.wait()).toBe(0);
      expect(out).toBe("hi\n");
    } finally {
      wss.close();
    }
  });

  it("terminate() sends a terminate frame with graceMs", async () => {
    let termFrame: Record<string, unknown> | undefined;
    const { wss, port } = await startMockExecServer((ws) => {
      ws.on("message", (raw) => {
        const f = JSON.parse(raw.toString());
        if (f.type === "start") ws.send(JSON.stringify({ type: "started", pid: 1, execId: "e" }));
        else if (f.type === "terminate") {
          termFrame = f;
          ws.send(JSON.stringify({ type: "exit", code: 143 }));
        }
      });
    });
    try {
      const box = await boxForPort(port);
      const s = await box.exec.session({ cmd: "sleep 999" });
      s.terminate(2000);
      expect(await s.wait()).toBe(143);
      expect(termFrame).toMatchObject({ type: "terminate", graceMs: 2000 });
    } finally {
      wss.close();
    }
  });

  it("times out the handshake when the server never sends started", async () => {
    const { wss, port } = await startMockExecServer(() => {
      /* accept the socket but never reply */
    });
    try {
      const box = await boxForPort(port, 150);
      await expect(box.exec.session({ cmd: "x" })).rejects.toThrow(/handshake timed out/);
    } finally {
      wss.close();
    }
  });
});
