import { describe, it, expect, vi } from "vitest";
import { handleCommand } from "../../../repl/commands/command.js";
import { collectEvents } from "../helpers.js";

describe("handleCommand", () => {
  it("executes command and prints output", async () => {
    const mockRun = { result: "hello world" };
    const mockBox = {
      exec: { command: vi.fn().mockResolvedValue(mockRun) },
    };

    const events = await collectEvents(handleCommand(mockBox as any, "echo hello world"));

    expect(mockBox.exec.command).toHaveBeenCalledWith("echo hello world");
    expect(events).toContainEqual({ type: "log", message: "hello world" });
  });

  it("does not print when output is empty", async () => {
    const mockRun = { result: "" };
    const mockBox = {
      exec: { command: vi.fn().mockResolvedValue(mockRun) },
    };

    const events = await collectEvents(handleCommand(mockBox as any, "true"));

    expect(events).not.toContainEqual(expect.objectContaining({ type: "log" }));
  });

  it("prints usage when no command", async () => {
    const events = await collectEvents(handleCommand({} as any, ""));
    expect(events).toContainEqual({ type: "log", message: "Usage: /command <command>" });
  });
});
