import { Context } from "@deepseek-ai/cordis";
import { describe, expect, it } from "vitest";
import BoxRuntime from "../src/index.js";
import BoxSubprocessRuntime from "../src/subprocess.js";

const CWD = "/workspace/home";

/**
 * The remote path this package exists to provide, against a real box.
 *
 * Only Cordis and these two plugins are involved: the harness's own consumers
 * (bash-local, tool-bash, the loader) are exercised in the DeepSeek Harness
 * checkout, not here. Unit tests cover the bounded reader, but they cannot
 * catch a handshake, environment, or tree-kill regression.
 */
describe.skipIf(!process.env.UPSTASH_BOX_API_KEY)("dsh-box against a live box", () => {
  it("spawns, collects, isolates env, terminates the tree, and deletes the box", async () => {
    const ctx = new Context();
    // The owner allocates a box as soon as it loads, so cleanup has to cover
    // everything after this line, not just the assertions.
    const ownerFiber = await ctx.plugin(BoxRuntime, { cwd: CWD });
    let boxId = "";
    try {
      const subprocessFiber = await ctx.plugin(BoxSubprocessRuntime, {});
      boxId = (await ctx.box.getBox()).id;
      try {
        // resolveExecutable: bare PATH name, absolute verification, and both rejections.
        const bash = await ctx.subprocess.resolveExecutable("bash");
        expect(bash.startsWith("/")).toBe(true);
        await expect(ctx.subprocess.resolveExecutable(bash)).resolves.toBe(bash);
        await expect(
          ctx.subprocess.resolveExecutable("definitely-not-a-real-binary"),
        ).rejects.toThrow(/did not resolve/);
        await expect(ctx.subprocess.resolveExecutable("./relative")).rejects.toThrow(
          /relative path/,
        );

        // Collect readers keep stdout and stderr separate and report the exit code.
        const collected = ctx.subprocess.spawn({
          argv: ["/bin/sh", "-c", "echo to-stdout; echo to-stderr 1>&2; exit 7"],
          cwd: CWD,
          stdio: { stdin: "ignore", stdout: { maxBytes: 1_024 }, stderr: { maxBytes: 1_024 } },
          graceMs: 500,
          env: {},
        });
        await expect(collected.done).resolves.toEqual({ exitCode: 7, signal: null });
        expect(collected.pid).toBeGreaterThan(0);
        expect(collected.collected.stdout?.readFrom(0).text).toBe("to-stdout\n");
        expect(collected.collected.stderr?.readFrom(0).text).toBe("to-stderr\n");

        // Batch stdin, the disposition a shell executor uses when a command has input.
        const sorted = ctx.subprocess.spawn({
          argv: ["/usr/bin/sort"],
          cwd: CWD,
          stdio: {
            stdin: { data: "banana\napple\n" },
            stdout: { maxBytes: 1_024 },
            stderr: { maxBytes: 1_024 },
          },
          graceMs: 500,
          env: {},
        });
        await expect(sorted.done).resolves.toEqual({ exitCode: 0, signal: null });
        expect(sorted.collected.stdout?.readFrom(0).text).toBe("apple\nbanana\n");

        // An overflowing stream keeps its tail and says so.
        const overflow = ctx.subprocess.spawn({
          argv: ["/bin/sh", "-c", "seq 1 2000"],
          cwd: CWD,
          stdio: { stdin: "ignore", stdout: { maxBytes: 64 }, stderr: { maxBytes: 64 } },
          graceMs: 500,
          env: {},
        });
        await overflow.done;
        const tail = overflow.collected.stdout?.readFrom(0);
        expect(tail?.lossy).toBe(true);
        expect(tail?.text.endsWith("2000\n")).toBe(true);
        expect(tail?.text.length).toBeLessThanOrEqual(64);

        // Explicit env crosses; host ambient env does not. The sentinel is neither
        // DSH_-prefixed nor credential-shaped, so a host-inheriting provider would
        // carry it into the box.
        process.env.BOX_HOST_AMBIENT_SENTINEL = "leaked-from-host";
        try {
          const env = ctx.subprocess.spawn({
            argv: ["/bin/sh", "-c", 'echo "[$EXPLICIT][$BOX_HOST_AMBIENT_SENTINEL]"'],
            cwd: CWD,
            stdio: { stdin: "ignore", stdout: { maxBytes: 256 }, stderr: { maxBytes: 256 } },
            graceMs: 500,
            env: { EXPLICIT: "yes" },
          });
          await env.done;
          expect(env.collected.stdout?.readFrom(0).text).toBe("[yes][]\n");
        } finally {
          delete process.env.BOX_HOST_AMBIENT_SENTINEL;
        }

        // A tombstone must unset a box-owned name, not blank it: ${X-fallback}
        // distinguishes "absent" from "present but empty".
        const unset = ctx.subprocess.spawn({
          argv: ["/bin/sh", "-c", 'echo "[${HOSTNAME-absent}]"'],
          cwd: CWD,
          stdio: { stdin: "ignore", stdout: { maxBytes: 256 }, stderr: { maxBytes: 256 } },
          graceMs: 500,
          env: { HOSTNAME: undefined },
        });
        await unset.done;
        expect(unset.collected.stdout?.readFrom(0).text).toBe("[absent]\n");

        // terminate() reaps the whole tree and reports the delivered signal.
        const longRunning = ctx.subprocess.spawn({
          argv: ["/bin/sh", "-c", "sleep 60177 & sleep 60178 & wait"],
          cwd: CWD,
          stdio: { stdin: "ignore", stdout: { maxBytes: 256 }, stderr: { maxBytes: 256 } },
          graceMs: 1_000,
          env: {},
        });
        await expect
          .poll(() => longRunning.pid, { interval: 50, timeout: 15_000 })
          .toBeGreaterThan(0);
        longRunning.terminate();
        longRunning.terminate(); // idempotent server-side
        await expect(longRunning.waitForExit()).resolves.toBe(true);
        const outcome = await longRunning.done;
        expect(["SIGTERM", "SIGKILL"]).toContain(outcome.signal);
        expect(outcome.exitCode).toBeNull();

        // Count only real `sleep` processes: the probe's own cmdline holds the
        // marker, so an unfiltered scan would always find itself.
        const survivors = await (
          await ctx.box.getBox()
        ).exec.command(
          'c=0; for d in /proc/[0-9]*; do [ "$(cat "$d/comm" 2>/dev/null)" = "sleep" ] ' +
            '&& grep -qs 60177 "$d/cmdline" && c=$((c+1)); done; echo $c',
        );
        expect(survivors.result.trim()).toBe("0");
      } finally {
        // Subprocess first: it terminates live handles before the owner deletes
        // the box out from under them. Nested so a rejecting subprocess
        // disposal cannot skip the delete and leak the box.
        await subprocessFiber.dispose();
      }
    } finally {
      await ownerFiber.dispose();
    }

    // Disposal deleted the box. `Box.get` still resolves for a deleted id, so
    // absence from the account listing is the observable fact.
    const { Box } = await import("@upstash/box");
    const remaining = await Box.list({ apiKey: process.env.UPSTASH_BOX_API_KEY! });
    expect(remaining.map((box) => box.id)).not.toContain(boxId);
  }, 180_000);

  it("runs a terminal session with a real PTY, foreground signals, and teardown", async () => {
    const ctx = new Context();
    const ownerFiber = await ctx.plugin(BoxRuntime, { cwd: CWD });
    const subprocessFiber = await ctx.plugin(BoxSubprocessRuntime, {});

    try {
      const terminal = await ctx.subprocess.spawnTerminal({
        argv: ["/bin/bash", "--noprofile", "--norc", "-i"],
        cwd: CWD,
        rows: 24,
        cols: 80,
        graceMs: 1_000,
        env: { PS1: "READY> " },
      });

      let seen = "";
      terminal.output.on("data", (chunk: Buffer) => {
        seen += chunk.toString();
      });
      expect(terminal.pid).toBeGreaterThan(0);

      // A real PTY: `tty` names a pts device and the size is right from the
      // first read, not applied after the shell starts. Both lines are polled;
      // the size bytes can arrive after the device name.
      await terminal.write("tty; stty size\n");
      await expect.poll(() => seen, { interval: 100, timeout: 20_000 }).toContain("/dev/pts/");
      await expect.poll(() => seen, { interval: 100, timeout: 20_000 }).toContain("24 80");

      // The foreground group is the shell itself while it waits for input.
      const idle = await terminal.inspectForeground();
      expect(idle?.processGroupId).toBeGreaterThan(1);

      // Start a foreground child and wait for the foreground group to actually
      // MOVE off the shell. Polling for `> 1` would pass instantly against the
      // idle shell, and the interrupt would then hit bash rather than the child.
      await terminal.write("sleep 55311\n");
      await expect
        .poll(async () => (await terminal.inspectForeground())?.processGroupId, {
          interval: 200,
          timeout: 20_000,
        })
        .not.toBe(idle?.processGroupId);

      const child = await terminal.inspectForeground();
      expect(child?.processGroupId).not.toBe(idle?.processGroupId);
      const signalled = await terminal.signalForeground("SIGINT");
      expect(signalled).toBe(child?.processGroupId);

      // The child is gone right after the interrupt, before any teardown runs,
      // so the survivor check below cannot be satisfied by terminate() instead.
      await expect
        .poll(
          async () =>
            (
              await (
                await ctx.box.getBox()
              ).exec.command(
                'c=0; for d in /proc/[0-9]*; do [ "$(cat "$d/comm" 2>/dev/null)" = "sleep" ] ' +
                  '&& grep -qs 55311 "$d/cmdline" && c=$((c+1)); done; echo $c',
              )
            ).result.trim(),
          { interval: 250, timeout: 20_000 },
        )
        .toBe("0");

      // The interrupt killed the child, not the shell: it still answers.
      await terminal.write("echo STILL-ALIVE\n");
      await expect.poll(() => seen, { interval: 100, timeout: 20_000 }).toContain("STILL-ALIVE");

      // Teardown is idempotent and leaves nothing running.
      await terminal.terminate();
      await terminal.terminate();
      const outcome = await terminal.done;
      expect(outcome.exitCode === 0 || outcome.signal !== null).toBe(true);

      const survivors = await (
        await ctx.box.getBox()
      ).exec.command(
        'c=0; for d in /proc/[0-9]*; do [ "$(cat "$d/comm" 2>/dev/null)" = "sleep" ] ' +
          '&& grep -qs 55311 "$d/cmdline" && c=$((c+1)); done; echo $c',
      );
      expect(survivors.result.trim()).toBe("0");
    } finally {
      await subprocessFiber.dispose();
      await ownerFiber.dispose();
    }
  }, 180_000);
});
