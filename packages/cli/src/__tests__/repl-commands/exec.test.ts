import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleExec } from "../../repl-commands/exec.js";

describe("handleExec", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("executes command and prints output", async () => {
    const mockRun = {
      result: vi.fn().mockResolvedValue("hello world"),
    };
    const mockBox = {
      exec: vi.fn().mockResolvedValue(mockRun),
    };

    await handleExec(mockBox as any, "echo hello world");

    expect(mockBox.exec).toHaveBeenCalledWith("echo hello world");
    expect(logSpy).toHaveBeenCalledWith("hello world");
  });

  it("does not print when output is empty", async () => {
    const mockRun = {
      result: vi.fn().mockResolvedValue(""),
    };
    const mockBox = {
      exec: vi.fn().mockResolvedValue(mockRun),
    };

    await handleExec(mockBox as any, "true");

    expect(logSpy).not.toHaveBeenCalled();
  });

  it("prints usage when no command", async () => {
    await handleExec({} as any, "");
    expect(logSpy).toHaveBeenCalledWith("Usage: exec <command>");
  });
});
