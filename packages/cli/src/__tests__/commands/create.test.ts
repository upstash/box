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

import { Box } from "@upstash/box";
import { startRepl } from "../../repl/terminal.js";

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
      agentModel: "claude/sonnet_4_5",
      agentApiKey: "agent-key",
    });

    expect(Box.create).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "my-key",
        agent: { model: "claude/sonnet_4_5", apiKey: "agent-key" },
      }),
    );
    expect(startRepl).toHaveBeenCalledWith(mockBox);
  });

  it("defaults to UpstashKey when --agent-api-key is omitted", async () => {
    const mockBox = { id: "box-1" };
    vi.mocked(Box.create).mockResolvedValueOnce(mockBox as any);

    await createCommand({ token: "key", agentModel: "model" });

    expect(Box.create).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: { model: "model", apiKey: "UPSTASH_KEY" },
      }),
    );
  });

  it("resolves 'stored' to StoredKey", async () => {
    const mockBox = { id: "box-1" };
    vi.mocked(Box.create).mockResolvedValueOnce(mockBox as any);

    await createCommand({ token: "key", agentModel: "model", agentApiKey: "stored" });

    expect(Box.create).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: { model: "model", apiKey: "STORED_KEY" },
      }),
    );
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
      env: ["FOO=bar", "BAZ=qux"],
    });

    expect(Box.create).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: "python",
        git: { token: "gh-tok" },
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
});
