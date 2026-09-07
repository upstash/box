import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execCommand } from "../../commands/exec.js";
import { CliError } from "../../core/errors.js";

const getBox = vi.hoisted(() => vi.fn());
vi.mock("@upstash/box", () => ({ Box: { get: getBox } }));

/** Argv-level behaviour: what a caller receives for a given set of flags. */
describe("box exec", () => {
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    process.exitCode = undefined;
    process.env.UPSTASH_BOX_API_KEY = "box_test";
    getBox.mockReset();
  });
  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
    process.exitCode = undefined;
  });

  const written = () => stdout.mock.calls.map((call) => String(call[0])).join("");

  function boxWith(result: { stdout?: string; stderr?: string; exitCode?: number }) {
    getBox.mockResolvedValue({
      exec: {
        command: vi.fn().mockResolvedValue({
          stdout: result.stdout ?? "",
          stderr: result.stderr ?? "",
          exitCode: result.exitCode ?? 0,
        }),
        stream: vi.fn().mockResolvedValue({
          async *[Symbol.asyncIterator]() {
            if (result.stdout) yield { type: "output", data: result.stdout };
            yield { type: "exit", exitCode: result.exitCode ?? 0, cpuNs: 0 };
          },
        }),
      },
    });
  }

  it("joins the variadic command back together", async () => {
    boxWith({ stdout: "hi\n" });
    await execCommand(["echo", "hi"], { box: "b1" });
    expect(written()).toBe("hi\n");
  });

  it("emits one object under --json, streams and stderr apart", async () => {
    boxWith({ stdout: "out\n", stderr: "err\n", exitCode: 0 });
    await execCommand(["cmd"], { box: "b1", json: true });
    const parsed = JSON.parse(written());
    expect(parsed).toEqual({ stdout: "out\n", stderr: "err\n", exit_code: 0 });
  });

  it("passes a remote failure through as this process's exit code", async () => {
    // `box exec cmd && next` has to behave the way it would locally.
    boxWith({ exitCode: 3 });
    await execCommand(["false"], { box: "b1" });
    expect(process.exitCode).toBe(3);
  });

  it("passes the exit code through under --json too, and still prints the object", async () => {
    boxWith({ stdout: "partial\n", exitCode: 7 });
    await execCommand(["cmd"], { box: "b1", json: true });
    expect(JSON.parse(written()).exit_code).toBe(7);
    expect(process.exitCode).toBe(7);
  });

  it("refuses an empty command and explains the -- convention", async () => {
    await expect(execCommand([], { box: "b1" })).rejects.toThrow(CliError);
    await expect(execCommand([], { box: "b1" })).rejects.toThrow(/box exec -- ls -la/);
  });

  it("prints the box banner on stderr, never on stdout", async () => {
    boxWith({ stdout: "x" });
    await execCommand(["cmd"], { box: "b1", json: true });
    expect(stderr.mock.calls.map((c) => String(c[0])).join("")).toContain("box: b1 (from --box)");
    // stdout must stay parseable
    expect(() => JSON.parse(written())).not.toThrow();
  });
});
