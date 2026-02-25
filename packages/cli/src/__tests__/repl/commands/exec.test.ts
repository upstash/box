import { describe, it, expect, vi } from "vitest";
import { handleExec } from "../../../repl/commands/exec.js";
import type { REPLHooks } from "../../../repl/client.js";

function createHooks() {
  return {
    onLog: vi.fn() as unknown as REPLHooks["onLog"],
    onError: vi.fn() as unknown as REPLHooks["onError"],
    onStream: vi.fn() as unknown as REPLHooks["onStream"],
  };
}

describe("handleExec", () => {
  it("executes command and prints output", async () => {
    const mockRun = { result: "hello world" };
    const mockBox = {
      exec: vi.fn().mockResolvedValue(mockRun),
    };
    const hooks = createHooks();

    await handleExec(mockBox as any, "echo hello world", hooks);

    expect(mockBox.exec).toHaveBeenCalledWith("echo hello world");
    expect(hooks.onLog).toHaveBeenCalledWith("hello world");
  });

  it("does not print when output is empty", async () => {
    const mockRun = { result: "" };
    const mockBox = {
      exec: vi.fn().mockResolvedValue(mockRun),
    };
    const hooks = createHooks();

    await handleExec(mockBox as any, "true", hooks);

    expect(hooks.onLog).not.toHaveBeenCalled();
  });

  it("prints usage when no command", async () => {
    const hooks = createHooks();
    await handleExec({} as any, "", hooks);
    expect(hooks.onLog).toHaveBeenCalledWith("Usage: exec <command>");
  });
});
