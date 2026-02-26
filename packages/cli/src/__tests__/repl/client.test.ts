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

    it("dispatches known /command with start, complete, and suggestion events", async () => {
      const mockBox = {
        exec: vi.fn().mockResolvedValue({ result: "output" }),
      };
      const client = new BoxREPLClient(mockBox as any);
      const events = await collectEvents(client.handleInput("/exec ls"));

      expect(events[0]).toEqual({ type: "command:start", command: "exec", args: "ls" });
      expect(events).toContainEqual({ type: "log", message: "output" });
      expect(events).toContainEqual(
        expect.objectContaining({ type: "command:complete", command: "exec" }),
      );
      expect(events).toContainEqual({ type: "suggestion", text: "/files list ." });
    });

    it("yields command:not-found for unknown /command", async () => {
      const client = new BoxREPLClient({} as any);
      const events = await collectEvents(client.handleInput("/foobar"));
      expect(events).toContainEqual(
        expect.objectContaining({ type: "command:not-found", typed: "foobar" }),
      );
    });

    it("treats bare text as agent prompt (run)", async () => {
      async function* fakeStream() {
        yield { type: "text-delta" as const, text: "hi" };
      }
      const mockBox = {
        agent: { stream: vi.fn().mockReturnValue(fakeStream()) },
      };
      const client = new BoxREPLClient(mockBox as any);
      const events = await collectEvents(client.handleInput("hello world"));

      expect(events[0]).toEqual({ type: "command:start", command: "run", args: "hello world" });
      expect(events).toContainEqual({ type: "stream", text: "hi" });
      expect(events).toContainEqual(
        expect.objectContaining({ type: "command:complete", command: "run" }),
      );
      expect(events).toContainEqual({ type: "suggestion", text: "/snapshot" });
    });

    it("catches handler errors and yields error event", async () => {
      const mockBox = {
        exec: vi.fn().mockRejectedValue(new Error("boom")),
      };
      const client = new BoxREPLClient(mockBox as any);
      const events = await collectEvents(client.handleInput("/exec fail"));

      expect(events).toContainEqual({ type: "error", message: "Error: boom" });
    });
  });

  describe("getCommand", () => {
    it("returns null for non-command input", () => {
      expect(BoxREPLClient.getCommand("hello")).toBeNull();
    });

    it("returns null for unknown command", () => {
      expect(BoxREPLClient.getCommand("/foobar")).toBeNull();
    });

    it("parses command without args", () => {
      const result = BoxREPLClient.getCommand("/snapshot");
      expect(result).not.toBeNull();
      expect(result!.command.name).toBe("snapshot");
      expect(result!.args).toBe("");
    });

    it("parses command with args", () => {
      const result = BoxREPLClient.getCommand("/exec ls -la");
      expect(result).not.toBeNull();
      expect(result!.command.name).toBe("exec");
      expect(result!.args).toBe("ls -la");
    });
  });

  describe("suggestCommands", () => {
    it("returns commands matching prefix", () => {
      const suggestions = BoxREPLClient.suggestCommands("ex");
      expect(suggestions.map((c) => c.name)).toContain("exec");
    });

    it("returns empty for no match", () => {
      const suggestions = BoxREPLClient.suggestCommands("zzz");
      expect(suggestions).toEqual([]);
    });

    it("returns all commands for empty prefix", () => {
      const suggestions = BoxREPLClient.suggestCommands("");
      expect(suggestions.length).toBeGreaterThan(0);
    });
  });
});
