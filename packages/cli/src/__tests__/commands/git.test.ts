import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  gitCheckoutCommand,
  gitCloneCommand,
  gitConfigCommand,
  gitDiffCommand,
  gitExecCommand,
  gitStatusCommand,
} from "../../commands/git.js";
import { CliError } from "../../core/errors.js";

const getBox = vi.hoisted(() => vi.fn());
vi.mock("@upstash/box", () => ({ Box: { get: getBox } }));

describe("box git", () => {
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    process.exitCode = undefined;
    process.env.UPSTASH_BOX_API_KEY = "box_test";
    getBox.mockReset();
  });
  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
    process.exitCode = undefined;
  });

  const written = () => stdout.mock.calls.map((call) => String(call[0])).join("");

  function boxWith(git: Record<string, unknown>) {
    const cd = vi.fn().mockResolvedValue(undefined);
    getBox.mockResolvedValue({ cd, git });
    return cd;
  }

  const flags = { box: "b1", token: "box_test" };

  it("changes directory before the call, since the SDK derives the folder from its cwd", async () => {
    // cd resolves on a later tick, as a real request does. If the command does
    // not await it, status runs while the SDK is still at the workspace root.
    let arrived = false;
    const cd = vi.fn().mockImplementation(async (target: string) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      arrived = target === "my-repo";
    });
    const status = vi.fn().mockImplementation(async () => {
      if (!arrived) throw new Error("status ran before cd finished");
      return "?? a.txt";
    });
    getBox.mockResolvedValue({ cd, git: { status } });
    await gitStatusCommand({ ...flags, folder: "my-repo" });
    expect(cd).toHaveBeenCalledWith("my-repo");
    expect(written()).toContain("?? a.txt");
  });

  it("leaves the working directory alone when no folder is given", async () => {
    const cd = boxWith({ status: vi.fn().mockResolvedValue("?? a.txt") });
    await gitStatusCommand({ ...flags });
    expect(cd).not.toHaveBeenCalled();
  });

  it("sends the folder as the clone destination instead of cd-ing into it", async () => {
    const clone = vi.fn().mockResolvedValue(undefined);
    const cd = boxWith({ clone });
    await gitCloneCommand("https://example.com/me/my-app", { ...flags, folder: "my-app" });
    // cd would fail: the destination does not exist until the clone creates it.
    expect(cd).not.toHaveBeenCalled();
    expect(clone).toHaveBeenCalledWith({
      repo: "https://example.com/me/my-app",
      folder: "my-app",
    });
  });

  it("omits the destination when none was given, so the repo name is used", async () => {
    const clone = vi.fn().mockResolvedValue(undefined);
    boxWith({ clone });
    await gitCloneCommand("https://example.com/me/my-app", { ...flags });
    expect(clone).toHaveBeenCalledWith({ repo: "https://example.com/me/my-app" });
  });

  it("gives the connection the git token, which is where clone reads it from", async () => {
    // clone() has no token option. The SDK sends the token held by the Box
    // instance, so it has to be set when the box is opened. Asserting it as a
    // clone option would pass while every private clone ran unauthenticated.
    const clone = vi.fn().mockResolvedValue(undefined);
    boxWith({ clone });

    await gitCloneCommand("https://example.com/me/private", {
      ...flags,
      githubToken: "ghp_x",
    });

    expect(getBox).toHaveBeenCalledWith("b1", expect.objectContaining({ gitToken: "ghp_x" }));
    expect(clone).toHaveBeenCalledWith({ repo: "https://example.com/me/private" });
  });

  it("does not send a git token the caller never gave", async () => {
    const clone = vi.fn().mockResolvedValue(undefined);
    boxWith({ clone });

    await gitCloneCommand("https://example.com/me/public", { ...flags });

    expect(getBox.mock.calls[0]?.[1]).not.toHaveProperty("gitToken");
  });

  it("rejects a depth that is not a positive number", async () => {
    const clone = vi.fn();
    boxWith({ clone });
    await expect(gitCloneCommand("repo", { ...flags, depth: "deep" })).rejects.toThrow(CliError);
    await expect(gitCloneCommand("repo", { ...flags, depth: "0" })).rejects.toThrow(CliError);
    expect(clone).not.toHaveBeenCalled();
  });

  it("names the directory when empty output really means 'not a repository'", async () => {
    boxWith({
      status: vi.fn().mockResolvedValue(""),
      exec: vi.fn().mockResolvedValue({ output: "", exit_code: 128 }),
    });
    await expect(gitStatusCommand({ ...flags, folder: "my-repo" })).rejects.toThrow(
      /Not a git repository: "my-repo"/,
    );
  });

  it("does not call a bare repository a clean working tree", async () => {
    // A bare repository exits 0 and prints "false", so the exit code alone
    // misclassifies it and its empty status reads as clean.
    boxWith({
      status: vi.fn().mockResolvedValue(""),
      exec: vi.fn().mockResolvedValue({ output: "false\n", exit_code: 0 }),
    });
    await expect(gitStatusCommand({ ...flags, folder: "bare" })).rejects.toThrow(
      /Not a git repository/,
    );
  });

  it("refuses to call an unreachable probe a clean tree", async () => {
    boxWith({
      status: vi.fn().mockResolvedValue(""),
      exec: vi.fn().mockRejectedValue(new Error("network")),
    });
    // Empty output plus a failed check is not evidence of anything.
    await expect(gitStatusCommand({ ...flags, folder: "my-repo" })).rejects.toThrow(
      /Could not check whether "my-repo"/,
    );
  });

  it("stays quiet when empty output means a clean tree", async () => {
    boxWith({
      status: vi.fn().mockResolvedValue(""),
      exec: vi.fn().mockResolvedValue({ output: "true", exit_code: 0 }),
    });
    await gitStatusCommand({ ...flags, folder: "my-repo" });
    expect(process.exitCode).toBeUndefined();
    // Silent means nothing at all: a bare newline is still a byte on a stdout
    // that is meant to be pipeable.
    expect(written()).toBe("");
  });

  it("still emits the empty status under --json", async () => {
    boxWith({
      status: vi.fn().mockResolvedValue(""),
      exec: vi.fn().mockResolvedValue({ output: "true", exit_code: 0 }),
    });
    await gitStatusCommand({ ...flags, folder: "my-repo", json: true });
    expect(JSON.parse(written())).toBe("");
  });

  it("applies the same check to an empty diff", async () => {
    boxWith({
      diff: vi.fn().mockResolvedValue(""),
      exec: vi.fn().mockResolvedValue({ output: "", exit_code: 128 }),
    });
    await expect(gitDiffCommand({ ...flags })).rejects.toThrow(/the workspace root/);
  });

  describe("checkout", () => {
    function boxOnBranch(head: string) {
      const checkout = vi.fn().mockResolvedValue(undefined);
      const exec = vi.fn().mockResolvedValue({ output: `${head}\n`, exit_code: 0 });
      boxWith({ checkout, exec });
      return { checkout, exec };
    }

    it("reports the branch it actually landed on", async () => {
      boxOnBranch("feature/x");
      await gitCheckoutCommand("feature/x", { ...flags });
      expect(written()).toContain("On branch feature/x");
    });

    it("refuses to call restoring a file a branch switch", async () => {
      // `git checkout README` succeeds and leaves HEAD alone; the endpoint
      // reports success either way, so a script would carry on believing it
      // had switched.
      boxOnBranch("main");
      await expect(gitCheckoutCommand("README", { ...flags })).rejects.toThrow(
        /Asked to switch to "README", but the repository is on "main"/,
      );
    });

    it("accepts a detached head when it is the requested commit", async () => {
      const checkout = vi.fn().mockResolvedValue(undefined);
      const exec = vi.fn().mockImplementation(({ args }: { args: string[] }) => {
        if (args[1] === "--abbrev-ref") return Promise.resolve({ output: "HEAD", exit_code: 0 });
        // Both HEAD and the requested ref resolve to the same commit.
        return Promise.resolve({ output: "abc1234\n", exit_code: 0 });
      });
      boxWith({ checkout, exec });
      await gitCheckoutCommand("abc1234", { ...flags });
      expect(written()).toContain("Detached HEAD at abc1234");
    });

    it("refuses a detached head that is not where it was asked to go", async () => {
      // Already detached, and `checkout README` only restored a file: HEAD
      // reads as "HEAD" either way, so only the commits tell them apart.
      const checkout = vi.fn().mockResolvedValue(undefined);
      const exec = vi.fn().mockImplementation(({ args }: { args: string[] }) => {
        if (args[1] === "--abbrev-ref") return Promise.resolve({ output: "HEAD", exit_code: 0 });
        if (args.some((arg) => arg.startsWith("HEAD^"))) {
          return Promise.resolve({ output: "abc1234\n", exit_code: 0 });
        }
        // README is not a ref, so it resolves to nothing.
        return Promise.resolve({ output: "", exit_code: 1 });
      });
      boxWith({ checkout, exec });
      await expect(gitCheckoutCommand("README", { ...flags })).rejects.toThrow(
        /Asked to switch to "README"/,
      );
    });

    it("fails when the branch cannot be read back", async () => {
      // Falling back to the requested branch would restore the false success
      // the read-back exists to prevent, one step further along.
      const checkout = vi.fn().mockResolvedValue(undefined);
      boxWith({ checkout, exec: vi.fn().mockRejectedValue(new Error("network")) });
      await expect(gitCheckoutCommand("feature/x", { ...flags })).rejects.toThrow(
        /could not confirm the branch/,
      );
    });

    it("fails when the read-back itself returns non-zero", async () => {
      const checkout = vi.fn().mockResolvedValue(undefined);
      boxWith({ checkout, exec: vi.fn().mockResolvedValue({ output: "", exit_code: 128 }) });
      await expect(gitCheckoutCommand("feature/x", { ...flags })).rejects.toThrow(
        /could not confirm the branch/,
      );
    });
  });

  it("passes git's own exit code through", async () => {
    boxWith({ exec: vi.fn().mockResolvedValue({ output: "", exit_code: 1 }) });
    await gitExecCommand(["diff", "--quiet"], { ...flags });
    expect(process.exitCode).toBe(1);
  });

  it("writes git's output unchanged, without trimming", async () => {
    // git exec runs arbitrary commands; trimming stops output like cat-file
    // from round-tripping.
    boxWith({ exec: vi.fn().mockResolvedValue({ output: "  a\n\nb\n\n", exit_code: 0 }) });
    await gitExecCommand(["cat-file", "-p", "HEAD"], { ...flags });
    expect(written()).toBe("  a\n\nb\n\n");
  });

  it("fails when git config reports something other than a missing key", async () => {
    // git uses 1 for "not found"; other statuses mean an unreadable config.
    boxWith({
      exec: vi.fn().mockResolvedValue({ output: "bad config line 3", exit_code: 3 }),
      updateConfig: vi.fn(),
    });
    await expect(gitConfigCommand({ ...flags })).rejects.toThrow(/git exited 3/);
  });

  it("does not set an exit code for a successful command", async () => {
    boxWith({ exec: vi.fn().mockResolvedValue({ output: "main", exit_code: 0 }) });
    await gitExecCommand(["rev-parse", "--abbrev-ref", "HEAD"], { ...flags });
    expect(process.exitCode).toBeUndefined();
    expect(written()).toContain("main");
  });

  it("rejects a leading 'git', which the server adds itself", async () => {
    const exec = vi.fn();
    boxWith({ exec });
    await expect(gitExecCommand(["git", "status"], { ...flags })).rejects.toThrow(CliError);
    expect(exec).not.toHaveBeenCalled();
  });

  it("rejects an empty command", async () => {
    boxWith({ exec: vi.fn() });
    await expect(gitExecCommand([], { ...flags })).rejects.toThrow(CliError);
  });

  it("reads the identity from git when neither flag is given", async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce({ output: "Box CLI\n", exit_code: 0 })
      .mockResolvedValueOnce({ output: "cli@upstash.com\n", exit_code: 0 });
    const updateConfig = vi.fn();
    boxWith({ exec, updateConfig });
    await gitConfigCommand({ ...flags });
    expect(updateConfig).not.toHaveBeenCalled();
    expect(written()).toContain("Box CLI <cli@upstash.com>");
  });

  it("reports an unset identity rather than an empty pair", async () => {
    // git config --get exits non-zero when the key is unset, which is an answer.
    boxWith({
      exec: vi.fn().mockResolvedValue({ output: "", exit_code: 1 }),
      updateConfig: vi.fn(),
    });
    await gitConfigCommand({ ...flags });
    expect(written()).toContain("(unset) <(unset)>");
  });

  it("does not report a failed lookup as an unset identity", async () => {
    // A request that could not run is not evidence that nothing is configured.
    boxWith({
      exec: vi.fn().mockRejectedValue(new Error("network")),
      updateConfig: vi.fn(),
    });
    await expect(gitConfigCommand({ ...flags })).rejects.toThrow();
    expect(written()).not.toContain("(unset)");
  });

  it("writes the identity when a flag is given", async () => {
    const updateConfig = vi
      .fn()
      .mockResolvedValue({ git_user_name: "Box CLI", git_user_email: "cli@upstash.com" });
    boxWith({ exec: vi.fn(), updateConfig });
    await gitConfigCommand({ ...flags, name: "Box CLI" });
    expect(updateConfig).toHaveBeenCalledWith({ userName: "Box CLI" });
  });
});
