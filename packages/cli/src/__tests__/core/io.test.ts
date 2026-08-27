import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CLI_FAILURE_EXIT_CODE, CliError, exitCodeFor, messageFor } from "../../core/errors.js";
import { emit, note, requireToken, runCommand } from "../../core/io.js";

describe("exit codes", () => {
  it("uses 125 for a CLI failure, so it cannot be confused with a command's own status", () => {
    expect(exitCodeFor(new CliError("bad usage"))).toBe(CLI_FAILURE_EXIT_CODE);
    expect(exitCodeFor(new Error("anything else"))).toBe(CLI_FAILURE_EXIT_CODE);
  });

  it("passes a remote command's exit code through unchanged", () => {
    expect(exitCodeFor(new CliError("command failed", { exitCode: 1 }))).toBe(1);
    expect(exitCodeFor(new CliError("command failed", { exitCode: 3 }))).toBe(3);
  });

  it("prints something usable for a non-Error throw", () => {
    expect(messageFor("plain string")).toBe("plain string");
    expect(messageFor({ code: 7 })).toBe('{"code":7}');
  });
});

describe("runCommand", () => {
  let stderr: ReturnType<typeof vi.spyOn>;
  let stdout: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    process.exitCode = undefined;
  });
  afterEach(() => {
    stderr.mockRestore();
    stdout.mockRestore();
    process.exitCode = undefined;
  });

  it("leaves the exit code alone on success", async () => {
    await runCommand(async () => {});
    expect(process.exitCode).toBeUndefined();
  });

  it("reports failures on stderr, never on stdout", async () => {
    // An agent reading `box files read missing` must not receive an error
    // object on stdout and treat it as the file's contents.
    await runCommand(async () => {
      throw new CliError("no such file");
    });
    expect(stderr).toHaveBeenCalledWith("Error: no such file\n");
    expect(stdout).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(CLI_FAILURE_EXIT_CODE);
  });

  it("carries a command's exit code out of the failure", async () => {
    await runCommand(async () => {
      throw new CliError("exited 3", { exitCode: 3 });
    });
    expect(process.exitCode).toBe(3);
  });
});

describe("emit", () => {
  let stdout: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    stdout.mockRestore();
  });

  it("prints raw data under --json, with no envelope", () => {
    emit({ id: "abc", status: "idle" }, "ignored", { json: true });
    const written = String(stdout.mock.calls[0]?.[0]);
    const parsed = JSON.parse(written);
    expect(parsed).toEqual({ id: "abc", status: "idle" });
    expect(parsed).not.toHaveProperty("data");
    expect(parsed).not.toHaveProperty("ok");
  });

  it("prints text lines when not emitting JSON", () => {
    emit({ ignored: true }, ["first", "second"], {});
    expect(stdout).toHaveBeenCalledWith("first\n");
    expect(stdout).toHaveBeenCalledWith("second\n");
  });
});

describe("note", () => {
  it("writes diagnostics to stderr so stdout stays parseable", () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    note("box: abc (from --box)");
    expect(stderr).toHaveBeenCalledWith("box: abc (from --box)\n");
    stderr.mockRestore();
  });
});

describe("requireToken", () => {
  const original = process.env.UPSTASH_BOX_API_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.UPSTASH_BOX_API_KEY;
    else process.env.UPSTASH_BOX_API_KEY = original;
  });

  it("prefers the flag, then the environment", () => {
    process.env.UPSTASH_BOX_API_KEY = "from-env";
    expect(requireToken("from-flag")).toBe("from-flag");
    expect(requireToken()).toBe("from-env");
  });

  it("throws instead of exiting, so the failure is testable", () => {
    delete process.env.UPSTASH_BOX_API_KEY;
    // The old helper called process.exit, which is why tests had to spy on it
    // and could not assert on the failure itself.
    expect(() => requireToken()).toThrow(CliError);
    expect(() => requireToken()).toThrow(/UPSTASH_BOX_API_KEY/);
  });
});
