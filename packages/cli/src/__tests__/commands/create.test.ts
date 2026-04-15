import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCommand } from "../../commands/create.js";

vi.mock("@upstash/box", () => ({
  Box: {
    create: vi.fn(),
  },
  BoxApiKey: {
    UpstashKey: "UPSTASH_KEY",
    StoredKey: "STORED_KEY",
  },
}));

vi.mock("../../repl/terminal.js", () => ({
  startRepl: vi.fn(),
}));

vi.mock("../../auth.js", () => ({
  resolveToken: vi.fn((token?: string) => token ?? "resolved-token"),
}));

vi.mock("../../commands/create-wizard.js", () => ({
  createWizard: vi.fn(),
}));

import { Box } from "@upstash/box";
import { startRepl } from "../../repl/terminal.js";
import { createWizard } from "../../commands/create-wizard.js";

describe("createCommand", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  it("creates a box and starts REPL", async () => {
    const mockBox = { id: "box-1" };
    vi.mocked(Box.create).mockResolvedValueOnce(mockBox as any);

    await createCommand({
      token: "my-key",
      agentModel: "anthropic/claude-sonnet-4-5",
      agentHarness: "claude-code",
      agentApiKey: "agent-key",
    });

    expect(Box.create).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "my-key",
        agent: {
          harness: "claude-code",
          model: "anthropic/claude-sonnet-4-5",
          apiKey: "agent-key",
        },
      }),
    );
    expect(startRepl).toHaveBeenCalledWith(mockBox);
  });

  it("sends undefined apiKey when --agent-api-key is omitted", async () => {
    const mockBox = { id: "box-1" };
    vi.mocked(Box.create).mockResolvedValueOnce(mockBox as any);

    await createCommand({ token: "key", agentModel: "model", agentHarness: "claude-code" });

    expect(Box.create).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: { harness: "claude-code", model: "model", apiKey: undefined },
      }),
    );
  });

  it("resolves 'stored' to StoredKey", async () => {
    const mockBox = { id: "box-1" };
    vi.mocked(Box.create).mockResolvedValueOnce(mockBox as any);

    await createCommand({
      token: "key",
      agentModel: "model",
      agentHarness: "claude-code",
      agentApiKey: "stored",
    });

    expect(Box.create).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: { harness: "claude-code", model: "model", apiKey: "STORED_KEY" },
      }),
    );
  });

  it("supports deprecated agentRunner flag", async () => {
    const mockBox = { id: "box-1" };
    vi.mocked(Box.create).mockResolvedValueOnce(mockBox as any);

    await createCommand({ token: "key", agentModel: "model", agentRunner: "codex" });

    expect(Box.create).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: { harness: "codex", model: "model", apiKey: undefined },
      }),
    );
  });

  it("prioritizes agentHarness over deprecated aliases", async () => {
    const mockBox = { id: "box-1" };
    vi.mocked(Box.create).mockResolvedValueOnce(mockBox as any);

    await createCommand({
      token: "key",
      agentModel: "model",
      agentHarness: "opencode",
      agentProvider: "claude-code",
      agentRunner: "codex",
    });

    expect(Box.create).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: { harness: "opencode", model: "model", apiKey: undefined },
      }),
    );
  });

  it("errors when agentModel is set without a harness flag", async () => {
    await createCommand({ token: "key", agentModel: "model" });
    expect(errorSpy).toHaveBeenCalledWith(
      "agent harness is required when --agent-model is set. Use --agent-harness (preferred), or the deprecated aliases --agent-provider / --agent-runner.",
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("passes runtime, git token, and env vars", async () => {
    const mockBox = { id: "box-1" };
    vi.mocked(Box.create).mockResolvedValueOnce(mockBox as any);

    await createCommand({
      token: "key",
      agentModel: "model",
      agentApiKey: "agent-key",
      runtime: "python",
      gitToken: "gh-tok",
      gitUserName: "John Doe",
      gitUserEmail: "john@example.com",
      env: ["FOO=bar", "BAZ=qux"],
    });

    expect(Box.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: "python",
        git: {
          token: "gh-tok",
          userName: "John Doe",
          userEmail: "john@example.com",
        },
        env: { FOO: "bar", BAZ: "qux" },
      }),
    );
  });

  it("exits on invalid env format", async () => {
    await createCommand({
      token: "key",
      agentModel: "model",
      agentApiKey: "agent-key",
      env: ["INVALID"],
    });
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid env format"));
  });

  describe("wizard delegation", () => {
    let origIsTTY: boolean | undefined;

    beforeEach(() => {
      origIsTTY = process.stdin.isTTY;
    });

    afterEach(() => {
      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
    });

    it("calls wizard when no config flags and TTY", async () => {
      Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
      const mockBox = { id: "box-1" };
      vi.mocked(Box.create).mockResolvedValueOnce(mockBox as any);
      vi.mocked(createWizard).mockResolvedValueOnce({
        runtime: "python",
        agentModel: "anthropic/claude-sonnet-4-5",
      });

      await createCommand({ token: "key" });

      expect(createWizard).toHaveBeenCalled();
      expect(Box.create).toHaveBeenCalledWith(expect.objectContaining({ runtime: "python" }));
    });

    it("skips wizard when config flags are present", async () => {
      Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
      const mockBox = { id: "box-1" };
      vi.mocked(Box.create).mockResolvedValueOnce(mockBox as any);

      await createCommand({ token: "key", agentModel: "anthropic/claude-sonnet-4-5" });

      expect(createWizard).not.toHaveBeenCalled();
    });

    it("aborts when wizard returns undefined", async () => {
      Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
      vi.mocked(createWizard).mockResolvedValueOnce(undefined);

      await createCommand({ token: "key" });

      expect(createWizard).toHaveBeenCalled();
      expect(Box.create).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Aborted"));
    });

    it("skips wizard when not TTY", async () => {
      Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
      const mockBox = { id: "box-1" };
      vi.mocked(Box.create).mockResolvedValueOnce(mockBox as any);

      await createCommand({ token: "key" });

      expect(createWizard).not.toHaveBeenCalled();
    });
  });
});
