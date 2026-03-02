import { describe, it, expect, vi } from "vitest";
import { handleCode } from "../../../repl/commands/code.js";
import { collectEvents } from "../helpers.js";

describe("handleCode", () => {
  it("executes JS code and prints output", async () => {
    const mockBox = {
      exec: {
        code: vi.fn().mockResolvedValue({ output: '{"sum":3}', exit_code: 0 }),
      },
    };

    const events = await collectEvents(handleCode(mockBox as any, "js console.log(1 + 2)"));

    expect(mockBox.exec.code).toHaveBeenCalledWith({ code: "console.log(1 + 2)", lang: "js" });
    expect(events).toContainEqual({ type: "log", message: '{"sum":3}' });
  });

  it("executes Python code", async () => {
    const mockBox = {
      exec: {
        code: vi.fn().mockResolvedValue({ output: "hello", exit_code: 0 }),
      },
    };

    const events = await collectEvents(handleCode(mockBox as any, "python print('hello')"));

    expect(mockBox.exec.code).toHaveBeenCalledWith({ code: "print('hello')", lang: "python" });
    expect(events).toContainEqual({ type: "log", message: "hello" });
  });

  it("prints error on failed execution", async () => {
    const mockBox = {
      exec: {
        code: vi.fn().mockResolvedValue({ output: "", exit_code: 1, error: "SyntaxError" }),
      },
    };

    const events = await collectEvents(handleCode(mockBox as any, "js !!!"));

    expect(events).toContainEqual({ type: "error", message: "SyntaxError" });
  });

  it("prints exit code when no output or error", async () => {
    const mockBox = {
      exec: {
        code: vi.fn().mockResolvedValue({ output: "", exit_code: 0 }),
      },
    };

    const events = await collectEvents(handleCode(mockBox as any, "js void 0"));

    expect(events).toContainEqual({ type: "log", message: "(exit code: 0)" });
  });

  it("rejects unsupported language", async () => {
    const events = await collectEvents(handleCode({} as any, "ruby puts 'hi'"));

    expect(events).toContainEqual(
      expect.objectContaining({ type: "error", message: expect.stringContaining("ruby") }),
    );
  });

  it("prints usage when no args", async () => {
    const events = await collectEvents(handleCode({} as any, ""));

    expect(events).toContainEqual(
      expect.objectContaining({ type: "log", message: expect.stringContaining("Usage") }),
    );
  });

  it("prints usage when only language provided", async () => {
    const events = await collectEvents(handleCode({} as any, "js"));

    expect(events).toContainEqual(
      expect.objectContaining({ type: "log", message: expect.stringContaining("Usage") }),
    );
  });
});
