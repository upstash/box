import { describe, it, expect, vi } from "vitest";
import { execCollect, execStream, quoteShellArg, withCwd } from "../../core/exec.js";

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
});
