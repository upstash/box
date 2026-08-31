import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Agent, Box, ClaudeCode } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";

const text = (b: Uint8Array) => Buffer.from(b).toString();

describe.skipIf(!UPSTASH_BOX_API_KEY)("exec.session", () => {
  let box: Box;

  beforeAll(async () => {
    box = await Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: { runner: Agent.ClaudeCode, model: ClaudeCode.Haiku_4_5 },
    });
  }, 120000);

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("streams stdout and stderr separately and reports the exit code", async () => {
    let out = "";
    let err = "";
    const session = await box.exec.session({
      argv: ["sh", "-c", "echo to-stdout; echo to-stderr 1>&2; exit 42"],
      onStdout: (b) => (out += text(b)),
      onStderr: (b) => (err += text(b)),
    });

    expect(session.pid).toBeGreaterThan(0);
    expect(session.execId).not.toBe("");
    expect(await session.wait()).toBe(42);
    expect(out.trim()).toBe("to-stdout");
    expect(err.trim()).toBe("to-stderr");
  });

  it("runs argv without a shell", async () => {
    let out = "";
    const session = await box.exec.session({
      argv: ["echo", "$HOME; rm -rf /"],
      onStdout: (b) => (out += text(b)),
    });
    await session.wait();
    // A shell would expand $HOME and treat `;` as a separator.
    expect(out.trim()).toBe("$HOME; rm -rf /");
  });

  it("runs cmd through a shell", async () => {
    let out = "";
    const session = await box.exec.session({
      cmd: "echo shell-$((1+1))",
      onStdout: (b) => (out += text(b)),
    });
    await session.wait();
    expect(out.trim()).toBe("shell-2");
  });

  it("writes stdin and lets endStdin() finish an EOF-reading command", async () => {
    let out = "";
    const session = await box.exec.session({
      argv: ["sort"],
      onStdout: (b) => (out += text(b)),
    });
    session.write("banana\napple\ncherry\n");
    session.endStdin();

    expect(await session.wait()).toBe(0);
    expect(out).toBe("apple\nbanana\ncherry\n");
  });

  it("honors cwd and overlays env", async () => {
    await box.files.mkdir("session-proj/src", { parents: true });
    let out = "";
    const session = await box.exec.session({
      argv: ["sh", "-c", "pwd; echo $MY_VAR"],
      cwd: "session-proj/src",
      env: ["MY_VAR=from-test"],
      onStdout: (b) => (out += text(b)),
    });
    await session.wait();

    expect(out).toContain("/workspace/home/session-proj/src");
    expect(out).toContain("from-test");
    await box.files.remove("session-proj", { recursive: true });
  });

  it("drops blocked env keys but passes ordinary ones", async () => {
    let out = "";
    const session = await box.exec.session({
      argv: ["sh", "-c", "echo LD=[$LD_PRELOAD] SAFE=[$SAFE]"],
      env: ["LD_PRELOAD=/tmp/evil.so", "SAFE=yes"],
      onStdout: (b) => (out += text(b)),
    });
    await session.wait();

    expect(out).toContain("LD=[]");
    expect(out).toContain("SAFE=[yes]");
  });

  it("terminate() stops a long-running process", async () => {
    const session = await box.exec.session({ argv: ["sleep", "300"] });
    session.terminate(1000);
    expect(await session.wait()).not.toBe(0);
  });

  it("kill() reaps the whole process tree", async () => {
    const running = async () =>
      (
        await box.exec.command(
          `c=0; for d in /proc/[0-9]*; do [ "$(cat "$d/comm" 2>/dev/null)" = "sleep" ] && grep -qs 4711 "$d/cmdline" && c=$((c+1)); done; echo $c`,
        )
      ).result.trim();

    const session = await box.exec.session({ cmd: "sleep 4711 & sleep 4712 & wait" });
    await new Promise((r) => setTimeout(r, 800));
    expect(await running()).not.toBe("0");

    session.kill("TERM");
    await session.wait();
    await new Promise((r) => setTimeout(r, 500));
    expect(await running()).toBe("0");
  });

  it("allocates a real PTY at the requested size and accepts interactive input", async () => {
    let out = "";
    const session = await box.exec.session({
      tty: true,
      rows: 24,
      cols: 80,
      cmd: "tty; stty size; read line; echo GOT=$line; exit 0",
      onStdout: (b) => (out += text(b)),
    });
    await new Promise((r) => setTimeout(r, 400));
    session.write("hello-pty\n");

    expect(await session.wait()).toBe(0);
    expect(out).toContain("/dev/pts/");
    // Size must be right from the first read, not applied after the process starts.
    expect(out).toContain("24 80");
    expect(out).toContain("GOT=hello-pty");
  });

  it("keeps a long-lived process for multiple round-trips", async () => {
    let out = "";
    const session = await box.exec.session({
      argv: ["cat"],
      onStdout: (b) => (out += text(b)),
    });
    for (const msg of ["req-1\n", "req-2\n", "req-3\n"]) {
      session.write(msg);
      await new Promise((r) => setTimeout(r, 150));
    }
    expect(out).toContain("req-1");
    expect(out).toContain("req-2");
    expect(out).toContain("req-3");

    session.kill("KILL");
    await session.wait();
  });

  it("runs sessions concurrently without crosstalk", async () => {
    const results = await Promise.all(
      [1, 2, 3, 4].map(async (n) => {
        let out = "";
        const session = await box.exec.session({
          argv: ["sh", "-c", `sleep 0.${n}; echo worker-${n}`],
          onStdout: (b) => (out += text(b)),
        });
        return { n, code: await session.wait(), out: out.trim() };
      }),
    );
    for (const r of results) {
      expect(r.code).toBe(0);
      expect(r.out).toBe(`worker-${r.n}`);
    }
  });

  it("does not leak env between sessions", async () => {
    await (await box.exec.session({ argv: ["sh", "-c", "export LEAK=nope; true"] })).wait();
    let out = "";
    const session = await box.exec.session({
      argv: ["sh", "-c", "echo LEAK=[$LEAK]"],
      onStdout: (b) => (out += text(b)),
    });
    await session.wait();
    expect(out).toContain("LEAK=[]");
  });

  it("close() ends the session and stops the process", async () => {
    const session = await box.exec.session({ argv: ["sleep", "600"] });
    const pid = session.pid;
    session.close();
    await session.wait();

    await new Promise((r) => setTimeout(r, 1500));
    const alive = (
      await box.exec.command(`[ -d /proc/${pid} ] && echo yes || echo no`)
    ).result.trim();
    expect(alive).toBe("no");
  });

  it("rejects an empty command locally and an unsupported signal", async () => {
    await expect(box.exec.session({})).rejects.toThrow(/requires cmd or argv/);

    const session = await box.exec.session({ argv: ["sleep", "60"] });
    expect(() => session.kill("BOGUS")).toThrow(/unsupported signal/);
    session.close();
    await session.wait();
  });

  it("makes session writes visible to the files API", async () => {
    const session = await box.exec.session({
      argv: ["sh", "-c", "echo written-by-session > session-out.txt"],
    });
    expect(await session.wait()).toBe(0);

    expect((await box.files.read("session-out.txt")).trim()).toBe("written-by-session");
    const stat = await box.files.stat("session-out.txt");
    expect(stat.type).toBe("file");
    await box.files.remove("session-out.txt");
  });
});
