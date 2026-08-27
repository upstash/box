import { describe, it, expect, vi } from "vitest";
import { buildCommand, execCollect, execStream, quoteShellArg, withCwd } from "../../core/exec.js";
import { CliError } from "../../core/errors.js";

describe("buildCommand", () => {
  it("keeps a single argument as the shell expression it is", () => {
    // The documented way to detach a server; quoting it would make the whole
    // thing a command name.
    expect(buildCommand(["( npm run dev > dev.log 2>&1 & )"])).toBe(
      "( npm run dev > dev.log 2>&1 & )",
    );
  });

  it("preserves boundaries the local shell already resolved", () => {
    // Joined with spaces this becomes `node -e console.log("hello world")`,
    // which the remote shell splits into different words.
    expect(buildCommand(["node", "-e", 'console.log("hello world")'])).toBe(
      `'node' '-e' 'console.log("hello world")'`,
    );
  });

  it("quotes an argument containing spaces", () => {
    expect(buildCommand(["grep", "-n", "two words", "file.txt"])).toBe(
      `'grep' '-n' 'two words' 'file.txt'`,
    );
  });

  it("leaves ordinary argv alone in meaning", () => {
    expect(buildCommand(["ls", "-la"])).toBe("'ls' '-la'");
  });

  it("is empty for no arguments", () => {
    expect(buildCommand([])).toBe("");
    expect(buildCommand([""])).toBe("");
  });

  it("keeps an empty argument, which is a real argument", () => {
    // printf '<%s>' '' passes one empty argument; dropping it changes the
    // command, and this function's whole job is preserving argv.
    expect(buildCommand(["printf", "<%s>", ""])).toBe(`'printf' '<%s>' ''`);
  });
});

describe("withCwd", () => {
  it("leaves a command alone when no directory is given", () => {
    expect(withCwd("npm test")).toBe("npm test");
    expect(withCwd("npm test", "")).toBe("npm test");
  });

  it("chains with && so a failed cd stops the command", () => {
    // With `;` the command would run in the wrong directory instead of failing.
    expect(withCwd("npm test", "/app")).toBe("cd '/app' && npm test");
  });

  it("quotes a directory containing spaces or quotes", () => {
    expect(withCwd("ls", "/my dir")).toBe("cd '/my dir' && ls");
    expect(quoteShellArg("it's")).toBe(`'it'"'"'s'`);
  });
});

describe("execCollect", () => {
  it("keeps stdout and stderr apart, with the command's exit code", async () => {
    const box = {
      exec: {
        command: vi.fn().mockResolvedValue({ stdout: "out\n", stderr: "err\n", exitCode: 3 }),
      },
    };
    const result = await execCollect(box as never, "cmd");
    expect(result).toEqual({ stdout: "out\n", stderr: "err\n", exit_code: 3 });
  });

  it("treats a missing exit code as success", async () => {
    const box = {
      exec: { command: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: null }) },
    };
    expect((await execCollect(box as never, "cmd")).exit_code).toBe(0);
  });

  it("applies the working directory", async () => {
    const command = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    await execCollect({ exec: { command } } as never, "pwd", { cwd: "/tmp" });
    expect(command).toHaveBeenCalledWith("cd '/tmp' && pwd");
  });
});

describe("execStream", () => {
  function streamOf(chunks: unknown[]) {
    return {
      exec: {
        stream: vi.fn().mockResolvedValue({
          async *[Symbol.asyncIterator]() {
            for (const chunk of chunks) yield chunk;
          },
        }),
      },
    };
  }

  it("hands chunks over as they arrive and returns the exit code", async () => {
    const box = streamOf([
      { type: "output", data: "one" },
      { type: "output", data: "two" },
      { type: "exit", exitCode: 0, cpuNs: 1 },
    ]);
    const seen: string[] = [];
    const code = await execStream(box as never, "cmd", (chunk) => seen.push(chunk));
    expect(seen).toEqual(["one", "two"]);
    expect(code).toBe(0);
  });

  it("returns a non-zero exit code from the exit chunk", async () => {
    const box = streamOf([{ type: "exit", exitCode: 42, cpuNs: 0 }]);
    expect(await execStream(box as never, "cmd", () => {})).toBe(42);
  });

  it("refuses to call a truncated stream a success", async () => {
    // Defaulting to 0 would let `box exec ... && next` run next on a stream
    // that was cut off before the remote status arrived.
    const box = streamOf([{ type: "output", data: "partial" }]);
    await expect(execStream(box as never, "cmd", () => {})).rejects.toThrow(CliError);
  });
});
