import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCommand } from "../../commands/create.js";
import { CliError } from "../../core/errors.js";

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

// Never write a real .box into the package directory from a test.
const writeBoxFile = vi.hoisted(() => vi.fn(() => "/tmp/.box"));
vi.mock("../../core/box-ref.js", () => ({ writeBoxFile }));

import { Box } from "@upstash/box";
import { startRepl } from "../../repl/terminal.js";
import { createWizard } from "../../commands/create-wizard.js";

describe("createCommand", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => vi.restoreAllMocks());

  it("creates a box and starts REPL", async () => {
    const mockBox = { id: "box-1" };
    vi.mocked(Box.create).mockResolvedValueOnce(mockBox as any);
    const tty = process.stdin.isTTY;
    const outTty = process.stdout.isTTY;
    process.stdin.isTTY = true;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });

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
    process.stdin.isTTY = tty;
    Object.defineProperty(process.stdout, "isTTY", { value: outTty, configurable: true });
  });

  it("sends undefined apiKey when --agent-api-key is omitted", async () => {
    const mockBox = { id: "box-1" };
    vi.mocked(Box.create).mockResolvedValueOnce(mockBox as any);

    await createCommand({
      token: "key",
      agentModel: "model",
      agentHarness: "claude-code",
    });

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
    // A CliError, not process.exit: create runs inside the same error boundary
    // as every other command, so this exits 125 like any other CLI failure.
    await expect(createCommand({ token: "key", agentModel: "model" })).rejects.toThrow(
      /agent harness is required/,
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("rejects an unknown harness", async () => {
    await expect(
      createCommand({ token: "key", agentModel: "model", agentHarness: "nonesuch" }),
    ).rejects.toThrow(CliError);
    expect(Box.create).not.toHaveBeenCalled();
  });

  it("requires a token", async () => {
    const key = process.env.UPSTASH_BOX_API_KEY;
    delete process.env.UPSTASH_BOX_API_KEY;
    await expect(createCommand({})).rejects.toThrow(CliError);
    expect(exitSpy).not.toHaveBeenCalled();
    if (key !== undefined) process.env.UPSTASH_BOX_API_KEY = key;
  });

  it("rejects --init-command without --keep-alive, which the backend would 400", async () => {
    await expect(
      createCommand({
        token: "key",
        initCommand: "npm start",
        repl: false,
      }),
    ).rejects.toThrow(/keep-alive/);
    expect(Box.create).not.toHaveBeenCalled();
  });

  it("passes runtime, git token, and env vars", async () => {
    const mockBox = { id: "box-1" };
    vi.mocked(Box.create).mockResolvedValueOnce(mockBox as any);

    await createCommand({
      token: "key",
      agentModel: "model",
      agentHarness: "claude-code",
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

  it("passes labels to Box.create", async () => {
    vi.mocked(Box.create).mockResolvedValueOnce({ id: "box-1" } as any);

    await createCommand({
      token: "key",
      agentModel: "model",
      agentHarness: "claude-code",
      label: ["beta", "x-team"],
    });

    expect(Box.create).toHaveBeenCalledWith(
      expect.objectContaining({ labels: ["beta", "x-team"] }),
    );
  });

  it("omits labels when none provided", async () => {
    vi.mocked(Box.create).mockResolvedValueOnce({ id: "box-1" } as any);

    await createCommand({
      token: "key",
      agentModel: "model",
      agentHarness: "claude-code",
    });

    expect(Box.create).toHaveBeenCalledWith(expect.objectContaining({ labels: undefined }));
  });

  it("rejects an invalid env format", async () => {
    await expect(
      createCommand({
        token: "key",
        agentModel: "model",
        agentHarness: "claude-code",
        agentApiKey: "agent-key",
        env: ["INVALID"],
      }),
    ).rejects.toThrow(/Invalid env format/);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  describe("wizard delegation", () => {
    let origIsTTY: boolean | undefined;
    let origOutTTY: boolean | undefined;

    beforeEach(() => {
      origIsTTY = process.stdin.isTTY;
      origOutTTY = process.stdout.isTTY;
      // The wizard only runs for a fully interactive create.
      Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    });

    afterEach(() => {
      Object.defineProperty(process.stdin, "isTTY", { value: origIsTTY, configurable: true });
      Object.defineProperty(process.stdout, "isTTY", { value: origOutTTY, configurable: true });
    });

    it("calls wizard when no config flags and TTY", async () => {
      Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
      const mockBox = { id: "box-1" };
      vi.mocked(Box.create).mockResolvedValueOnce(mockBox as any);
      vi.mocked(createWizard).mockResolvedValueOnce({
        runtime: "python",
        agentModel: "anthropic/claude-sonnet-4-5",
        agentHarness: "claude-code",
      });

      await createCommand({ token: "key" });

      expect(createWizard).toHaveBeenCalled();
      // The wizard is where the harness comes from on a bare create; resolving
      // it before the merge made the command reject its own answer.
      expect(Box.create).toHaveBeenCalledWith(
        expect.objectContaining({
          runtime: "python",
          agent: expect.objectContaining({
            harness: "claude-code",
            model: "anthropic/claude-sonnet-4-5",
          }),
        }),
      );
    });

    it("skips the wizard for a headless create, terminal or not", async () => {
      Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
      vi.mocked(Box.create).mockResolvedValueOnce({
        id: "box-9",
        git: { clone: vi.fn() },
      } as any);

      // The scripted path from a developer's own shell, which has a terminal.
      await createCommand({ token: "key", repl: false, cloneRepo: "me/my-app" });

      expect(createWizard).not.toHaveBeenCalled();
      expect(startRepl).not.toHaveBeenCalled();
    });

    it("skips the wizard when a workspace flag already answered it", async () => {
      Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
      vi.mocked(Box.create).mockResolvedValueOnce({ id: "box-9" } as any);

      await createCommand({ token: "key", name: "my-box" });

      expect(createWizard).not.toHaveBeenCalled();
    });

    it("skips wizard when config flags are present", async () => {
      Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
      const mockBox = { id: "box-1" };
      vi.mocked(Box.create).mockResolvedValueOnce(mockBox as any);

      await createCommand({
        token: "key",
        agentModel: "anthropic/claude-sonnet-4-5",
        agentHarness: "claude-code",
      });

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

  describe("headless create", () => {
    const headlessFlags = {
      token: "key",
      agentModel: "model",
      agentHarness: "claude-code",
      repl: false,
    };

    it("prints the id, pins the directory and never opens the REPL", async () => {
      vi.mocked(Box.create).mockResolvedValueOnce({ id: "box-9" } as any);
      const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await createCommand(headlessFlags);

      // A pipe or a CI job has no terminal to drive the REPL.
      expect(startRepl).not.toHaveBeenCalled();
      expect(writeBoxFile).toHaveBeenCalledWith("box-9");
      expect(out.mock.calls.map((call) => String(call[0])).join("")).toContain("box-9");
      out.mockRestore();
    });

    it("skips the pin under --no-use", async () => {
      vi.mocked(Box.create).mockResolvedValueOnce({ id: "box-9" } as any);
      await createCommand({ ...headlessFlags, use: false });
      expect(writeBoxFile).not.toHaveBeenCalled();
    });

    it("goes headless when stdin is a pipe, even without --no-repl", async () => {
      Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
      Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
      vi.mocked(Box.create).mockResolvedValueOnce({ id: "box-9" } as any);
      await createCommand({ token: "key", agentModel: "model", agentHarness: "claude-code" });
      expect(startRepl).not.toHaveBeenCalled();
    });

    it("goes headless when only stdout is captured", async () => {
      // ID=$(box create ...) keeps stdin on the terminal but captures stdout.
      // Opening a REPL there hides its own output and holds a billing box open.
      const stdoutTty = process.stdout.isTTY;
      Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
      Object.defineProperty(process.stdout, "isTTY", { value: false, configurable: true });
      vi.mocked(Box.create).mockResolvedValueOnce({ id: "box-9" } as any);

      await createCommand({ token: "key", agentModel: "model", agentHarness: "claude-code" });

      expect(startRepl).not.toHaveBeenCalled();
      Object.defineProperty(process.stdout, "isTTY", { value: stdoutTty, configurable: true });
    });

    it("--json implies headless and emits one object", async () => {
      Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
      vi.mocked(Box.create).mockResolvedValueOnce({ id: "box-9" } as any);
      const out = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

      await createCommand({ ...headlessFlags, repl: undefined, json: true });

      expect(startRepl).not.toHaveBeenCalled();
      expect(JSON.parse(out.mock.calls.map((call) => String(call[0])).join(""))).toEqual({
        id: "box-9",
        pinned: "/tmp/.box",
      });
      out.mockRestore();
      Object.defineProperty(process.stdin, "isTTY", { value: undefined, configurable: true });
    });

    it("names the box it created when the clone fails", async () => {
      const clone = vi.fn().mockRejectedValue(new Error("repo not found"));
      vi.mocked(Box.create).mockResolvedValueOnce({ id: "box-9", git: { clone } } as any);
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

      // The box exists and is billing; failing without naming it would leave
      // the caller unable to reuse or delete it.
      // The reason matters as much as the id: a missing repo, a bad token and
      // an unreachable network all need different responses, and runCommand
      // prints only the message, never the cause.
      await expect(createCommand({ ...headlessFlags, cloneRepo: "owner/nope" })).rejects.toThrow(
        /Created box-9.*repo not found/s,
      );

      const warned = stderr.mock.calls.map((call) => String(call[0])).join("");
      expect(warned).toContain("box delete --yes box-9");
      expect(writeBoxFile).toHaveBeenCalledWith("box-9");
    });

    it("does not pin on clone failure during an interactive create", async () => {
      // A successful interactive create does not pin, so pinning on failure
      // could overwrite a project's existing .box.
      const stdinTty = process.stdin.isTTY;
      const stdoutTty = process.stdout.isTTY;
      Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
      Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
      const clone = vi.fn().mockRejectedValue(new Error("nope"));
      vi.mocked(Box.create).mockResolvedValueOnce({ id: "box-9", git: { clone } } as any);

      await expect(
        createCommand({
          token: "key",
          agentModel: "model",
          agentHarness: "claude-code",
          cloneRepo: "owner/nope",
        }),
      ).rejects.toThrow(/Created box-9/);

      expect(writeBoxFile).not.toHaveBeenCalled();
      Object.defineProperty(process.stdin, "isTTY", { value: stdinTty, configurable: true });
      Object.defineProperty(process.stdout, "isTTY", { value: stdoutTty, configurable: true });
    });

    it("clones into the new box when asked", async () => {
      const clone = vi.fn().mockResolvedValue(undefined);
      vi.mocked(Box.create).mockResolvedValueOnce({ id: "box-9", git: { clone } } as any);
      await createCommand({ ...headlessFlags, cloneRepo: "owner/repo", gitToken: "gh-tok" });
      expect(clone).toHaveBeenCalledWith({ repo: "owner/repo", githubToken: "gh-tok" });
    });

    it("passes the workspace flags through", async () => {
      vi.mocked(Box.create).mockResolvedValueOnce({ id: "box-9" } as any);
      await createCommand({
        ...headlessFlags,
        name: "my-box",
        size: "medium",
        keepAlive: true,
        initCommand: "npm start",
        browser: true,
      });
      expect(Box.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "my-box",
          size: "medium",
          keepAlive: true,
          initCommand: "npm start",
          browser: true,
        }),
      );
    });

    it("omits the workspace flags that were not given", async () => {
      vi.mocked(Box.create).mockResolvedValueOnce({ id: "box-9" } as any);
      await createCommand(headlessFlags);
      const config = vi.mocked(Box.create).mock.calls[0]![0]!;
      expect(config).not.toHaveProperty("name");
      expect(config).not.toHaveProperty("size");
      expect(config).not.toHaveProperty("keepAlive");
      expect(config).not.toHaveProperty("browser");
    });
  });
});
