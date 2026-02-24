import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fromSnapshotCommand } from "../../commands/from-snapshot.js";

vi.mock("@upstash/box", () => ({
  Box: {
    fromSnapshot: vi.fn(),
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

describe("fromSnapshotCommand", () => {
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

  it("creates box from snapshot and starts REPL", async () => {
    const mockBox = { id: "box-1" };
    vi.mocked(Box.fromSnapshot).mockResolvedValueOnce(mockBox as any);

    await fromSnapshotCommand("snap-1", {
      token: "key",
      agentModel: "model",
      agentApiKey: "agent-key",
    });

    expect(Box.fromSnapshot).toHaveBeenCalledWith(
      "snap-1",
      expect.objectContaining({
        apiKey: "key",
        agent: { model: "model", apiKey: "agent-key" },
      }),
    );
    expect(startRepl).toHaveBeenCalledWith(mockBox);
  });

  it("exits when --agent-api-key is missing", async () => {
    await fromSnapshotCommand("snap-1", { token: "key", agentModel: "model" });
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("--agent-api-key is required"));
  });
});
