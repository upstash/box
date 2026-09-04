import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CliError } from "../../core/errors.js";
import { fromSnapshotCommand } from "../../commands/from-snapshot.js";

vi.mock("@upstash/box", () => ({
  Box: {
    fromSnapshot: vi.fn(),
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

vi.mock("../../core/box-ref.js", () => ({
  writeBoxFile: vi.fn(() => "/tmp/.box"),
}));

/** Run a body as though a terminal were attached, then restore. */
async function withTty(body: () => Promise<void>): Promise<void> {
  const inTty = process.stdin.isTTY;
  const outTty = process.stdout.isTTY;
  process.stdin.isTTY = true;
  Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
  try {
    await body();
  } finally {
    process.stdin.isTTY = inTty;
    Object.defineProperty(process.stdout, "isTTY", { value: outTty, configurable: true });
  }
}

import { Box } from "@upstash/box";
import { startRepl } from "../../repl/terminal.js";
import { writeBoxFile } from "../../core/box-ref.js";

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

    await withTty(async () => {
      await fromSnapshotCommand("snap-1", {
        token: "key",
        agentModel: "model",
        agentHarness: "claude-code",
        agentApiKey: "agent-key",
      });
    });

    expect(Box.fromSnapshot).toHaveBeenCalledWith(
      "snap-1",
      expect.objectContaining({
        apiKey: "key",
        agent: { harness: "claude-code", model: "model", apiKey: "agent-key" },
      }),
    );
    expect(startRepl).toHaveBeenCalledWith(mockBox);
  });

  it("passes labels to Box.fromSnapshot", async () => {
    vi.mocked(Box.fromSnapshot).mockResolvedValueOnce({ id: "box-1" } as any);

    await fromSnapshotCommand("snap-1", { token: "key", label: ["beta", "x-team"] });

    expect(Box.fromSnapshot).toHaveBeenCalledWith(
      "snap-1",
      expect.objectContaining({ labels: ["beta", "x-team"] }),
    );
  });

  it("sends undefined apiKey when --agent-api-key is omitted", async () => {
    const mockBox = { id: "box-2" };
    vi.mocked(Box.fromSnapshot).mockResolvedValueOnce(mockBox as any);

    await withTty(async () => {
      await fromSnapshotCommand("snap-1", {
        token: "key",
        agentModel: "model",
        agentHarness: "claude-code",
      });
    });

    expect(Box.fromSnapshot).toHaveBeenCalledWith(
      "snap-1",
      expect.objectContaining({
        agent: { harness: "claude-code", model: "model", apiKey: undefined },
      }),
    );
    expect(startRepl).toHaveBeenCalledWith(mockBox);
  });

  it("restores without a REPL when --no-repl is given", async () => {
    // The reason snapshot list/delete were write-only: an agent could make a
    // snapshot and never restore one, because restore always opened a REPL.
    vi.mocked(Box.fromSnapshot).mockResolvedValueOnce({ id: "box-9" } as any);

    await withTty(async () => {
      await fromSnapshotCommand("snap-1", { token: "key", repl: false });
    });

    expect(startRepl).not.toHaveBeenCalled();
    expect(writeBoxFile).toHaveBeenCalledWith("box-9");
  });

  it("goes headless with no terminal, so a script does not hang", async () => {
    vi.mocked(Box.fromSnapshot).mockResolvedValueOnce({ id: "box-9" } as any);

    await fromSnapshotCommand("snap-1", { token: "key" });

    expect(startRepl).not.toHaveBeenCalled();
  });

  it("does not pin when --no-use is given", async () => {
    vi.mocked(Box.fromSnapshot).mockResolvedValueOnce({ id: "box-9" } as any);

    await fromSnapshotCommand("snap-1", { token: "key", repl: false, use: false });

    expect(writeBoxFile).not.toHaveBeenCalled();
  });

  it("errors when agentModel is set without a harness flag", async () => {
    await expect(
      fromSnapshotCommand("snap-1", { token: "key", agentModel: "model" }),
    ).rejects.toThrow(/agent harness is required/);
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
