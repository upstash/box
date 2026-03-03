import { describe, it, expect, vi } from "vitest";
import { BoxREPLClient } from "../../repl/client.js";
import { collectEvents } from "./helpers.js";

describe("BoxREPLClient", () => {
  describe("handleInput", () => {
    it("returns no events for empty input", async () => {
      const client = new BoxREPLClient({} as any);
      const events = await collectEvents(client.handleInput(""));
      expect(events).toEqual([]);
    });

    it("returns no events for whitespace-only input", async () => {
      const client = new BoxREPLClient({} as any);
      const events = await collectEvents(client.handleInput("   "));
      expect(events).toEqual([]);
    });

    it("yields exit for 'exit'", async () => {
      const client = new BoxREPLClient({} as any);
      const events = await collectEvents(client.handleInput("exit"));
      expect(events).toContainEqual({ type: "exit", message: "Goodbye." });
    });

    it("yields exit for '/exit'", async () => {
      const client = new BoxREPLClient({} as any);
      const events = await collectEvents(client.handleInput("/exit"));
      expect(events).toContainEqual({ type: "exit", message: "Goodbye." });
    });

    it("yields command:not-found for unknown /command", async () => {
      const client = new BoxREPLClient({} as any);
      const events = await collectEvents(client.handleInput("/foobar"));
      expect(events).toContainEqual(
        expect.objectContaining({ type: "command:not-found", typed: "foobar" }),
      );
    });

    it("catches handler errors and yields error event", async () => {
      const mockBox = {
        exec: { command: vi.fn().mockRejectedValue(new Error("boom")) },
      };
      const client = new BoxREPLClient(mockBox as any);
      const events = await collectEvents(client.handleInput("failing-command"));

      expect(events).toContainEqual({ type: "error", message: "Error: boom" });
    });

    // --- Shell mode (default) ---

    it("defaults to shell mode: bare text calls exec.command", async () => {
      const mockBox = {
        exec: { command: vi.fn().mockResolvedValue({ result: "output" }) },
      };
      const client = new BoxREPLClient(mockBox as any);
      expect(client.mode).toBe("shell");

      const events = await collectEvents(client.handleInput("ls -la"));

      expect(mockBox.exec.command).toHaveBeenCalledWith("ls -la");
      expect(events[0]).toEqual({ type: "command:start", command: "shell", args: "ls -la" });
      expect(events).toContainEqual({ type: "log", message: "output" });
      expect(events).toContainEqual(
        expect.objectContaining({ type: "command:complete", command: "shell" }),
      );
    });

    // --- Agent mode ---

    it("/agent switches to agent mode, bare text calls agent.stream", async () => {
      const client = new BoxREPLClient({} as any);

      // Switch to agent mode
      const switchEvents = await collectEvents(client.handleInput("/agent"));
      expect(client.mode).toBe("agent");
      expect(switchEvents).toContainEqual({ type: "log", message: "Switched to agent mode" });

      // Bare text should now go to agent
      async function* fakeStream() {
        yield { type: "text-delta" as const, text: "hi" };
      }
      const mockBox = {
        agent: { stream: vi.fn().mockReturnValue(fakeStream()) },
      };
      const agentClient = new BoxREPLClient(mockBox as any);
      agentClient.mode = "agent";

      const events = await collectEvents(agentClient.handleInput("hello world"));
      expect(events[0]).toEqual({ type: "command:start", command: "agent", args: "hello world" });
      expect(events).toContainEqual({ type: "stream", text: "hi" });
      expect(events).toContainEqual(
        expect.objectContaining({ type: "command:complete", command: "agent" }),
      );
    });

    // --- /shell switches back ---

    it("/shell switches back to shell mode", async () => {
      const client = new BoxREPLClient({} as any);
      client.mode = "agent";

      const events = await collectEvents(client.handleInput("/shell"));
      expect(client.mode).toBe("shell");
      expect(events).toContainEqual({ type: "log", message: "Switched to shell mode" });
    });

    // --- cd interception ---

    it("cd <path> with single arg treated as /cd", async () => {
      const mockBox = {
        cwd: "/workspace/home/src",
        cd: vi.fn().mockResolvedValue(undefined),
      };
      // Make box.cwd update after cd
      mockBox.cd.mockImplementation(async () => {
        mockBox.cwd = "/workspace/home/src";
      });

      const client = new BoxREPLClient(mockBox as any);
      const events = await collectEvents(client.handleInput("cd src"));

      expect(events[0]).toEqual({ type: "command:start", command: "cd", args: "src" });
      expect(mockBox.cd).toHaveBeenCalledWith("src");
      expect(events).toContainEqual(
        expect.objectContaining({ type: "command:complete", command: "cd" }),
      );
    });

    it("cd with compound command runs as shell and logs warning", async () => {
      const mockBox = {
        exec: { command: vi.fn().mockResolvedValue({ result: "file1\nfile2" }) },
      };
      const client = new BoxREPLClient(mockBox as any);
      const events = await collectEvents(client.handleInput("cd src && ls"));

      expect(mockBox.exec.command).toHaveBeenCalledWith("cd src && ls");
      expect(events).toContainEqual({
        type: "log",
        message: "Tip: use just 'cd <path>' to change the working directory",
      });
    });
  });

  describe("getCommand", () => {
    const client = new BoxREPLClient({} as any);

    it("returns null for non-command input", () => {
      expect(client["getCommand"]("hello")).toBeNull();
    });

    it("parses command without args", () => {
      const result = client["getCommand"]("/snapshot");
      expect(result).not.toBeNull();
      expect(result!.command.name).toBe("snapshot");
      expect(result!.args).toBe("");
    });

    it("parses command with args", () => {
      const result = client["getCommand"]("/code console.log('hi')");
      expect(result).not.toBeNull();
      expect(result!.command.name).toBe("code");
      expect(result!.args).toBe("console.log('hi')");
    });
  });

  describe("suggestCommands", () => {
    it("returns commands matching prefix", () => {
      const client = new BoxREPLClient({} as any);
      const suggestions = client.suggestCommands("co");
      expect(suggestions.map((c) => c.name)).toContain("code");
      expect(suggestions.map((c) => c.name)).toContain("console");
    });

    it("returns empty for no match", () => {
      const client = new BoxREPLClient({} as any);
      const suggestions = client.suggestCommands("zzz");
      expect(suggestions).toEqual([]);
    });

    it("returns all commands for empty prefix", () => {
      const client = new BoxREPLClient({} as any);
      const suggestions = client.suggestCommands("");
      expect(suggestions.length).toBeGreaterThan(0);
    });

    it("hides /shell when in shell mode", () => {
      const client = new BoxREPLClient({} as any);
      client.mode = "shell";
      const suggestions = client.suggestCommands("");
      const names = suggestions.map((c) => c.name);
      expect(names).not.toContain("shell");
      expect(names).toContain("agent");
    });

    it("hides /agent when in agent mode", () => {
      const client = new BoxREPLClient({} as any);
      client.mode = "agent";
      const suggestions = client.suggestCommands("");
      const names = suggestions.map((c) => c.name);
      expect(names).not.toContain("agent");
      expect(names).toContain("shell");
    });
  });
});
