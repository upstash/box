import { describe, it, expect, vi } from "vitest";
import { handleExec } from "../../../repl/commands/exec.js";
import { collectEvents } from "../helpers.js";

describe("handleExec", () => {
  it("executes command and prints output", async () => {
    const mockRun = { result: "hello world" };
    const mockBox = {
      exec: vi.fn().mockResolvedValue(mockRun),
    };

    const events = await collectEvents(handleExec(mockBox as any, "echo hello world"));

    expect(mockBox.exec).toHaveBeenCalledWith("echo hello world");
    expect(events).toContainEqual({ type: "log", message: "hello world" });
  });

  it("does not print when output is empty", async () => {
    const mockRun = { result: "" };
    const mockBox = {
      exec: vi.fn().mockResolvedValue(mockRun),
    };

    const events = await collectEvents(handleExec(mockBox as any, "true"));

    expect(events).not.toContainEqual(expect.objectContaining({ type: "log" }));
  });

  it("prints usage when no command", async () => {
    const events = await collectEvents(handleExec({} as any, ""));
    expect(events).toContainEqual({ type: "log", message: "Usage: exec <command>" });
  });
});
