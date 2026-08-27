import { existsSync } from "node:fs";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  CLI,
  UPSTASH_BOX_API_KEY,
  makeRunner,
  makeStdinRunner,
  workingDirectory,
} from "./setup.js";

const runnable = Boolean(UPSTASH_BOX_API_KEY) && existsSync(CLI);

/**
 * These drive the built binary against a real box, which is the only place the
 * process-level contracts are observable: what lands on stdout versus stderr,
 * what exit code a caller sees, and how the shell's argv survives the trip.
 */
describe.skipIf(!runnable)("box CLI against a real box", () => {
  const work = workingDirectory();
  const run = makeRunner(work.path);
  const runWithStdin = makeStdinRunner(work.path);
  let boxId = "";

  beforeAll(() => {
    const created = run("create", "--no-repl", "--runtime", "node", "--name", "cli-integration");
    boxId = created.stdout.trim();
    expect(boxId, `create failed: ${created.stderr}`).not.toBe("");
  }, 180_000);

  afterAll(() => {
    if (boxId) run("delete", "--yes", boxId);
    work.cleanup();
  }, 120_000);

  describe("box selection", () => {
    it("pins the new box so later commands need no arguments", () => {
      expect(run("status").stdout).toContain(boxId);
    });

    it("accepts the box on the root as well as the subcommand", () => {
      // Both spellings are advertised, so both have to reach the command.
      const root = run("--box", boxId, "--token", UPSTASH_BOX_API_KEY!, "status");
      const local = run("status", "--box", boxId, "--token", UPSTASH_BOX_API_KEY!);
      expect(root.status).toBe(0);
      expect(local.status).toBe(0);
      expect(root.stdout).toContain(boxId);
      expect(local.stdout).toContain(boxId);
    });
  });

  describe("stream separation", () => {
    it("keeps the banner off stdout so output can be piped", () => {
      const result = run("exec", "--", "echo", "clean");
      // Content, not exact bytes: the streaming endpoint appends a trailing
      // newline that the buffered one does not, so `printf abc` streams as
      // "abc\n" while --json reports "abc". That difference is below the CLI.
      expect(result.stdout.trim()).toBe("clean");
      expect(result.stdout).not.toContain(boxId);
      expect(result.stderr).toContain(boxId);
    });

    it("reports byte-exact output under --json", () => {
      const result = run("exec", "--json", "--", "printf abc");
      expect(JSON.parse(result.stdout).stdout).toBe("abc");
    });

    it("separates the remote command's own streams under --json", () => {
      const result = run("exec", "--json", "--", "echo out; echo err >&2");
      const parsed = JSON.parse(result.stdout);
      expect(parsed.stdout).toContain("out");
      expect(parsed.stderr).toContain("err");
      expect(parsed.exit_code).toBe(0);
    });
  });

  describe("exit codes", () => {
    it("passes the remote command's status through", () => {
      expect(run("exec", "--", "exit 7").status).toBe(7);
      expect(run("exec", "--", "true").status).toBe(0);
    });

    it("uses 125 for a failure of the CLI itself", () => {
      expect(run("--box", "no-such-box-anywhere", "exec", "--", "true").status).toBe(125);
      expect(run("files", "read").status).toBe(125);
      expect(run("no-such-command").status).toBe(125);
    });

    it("still exits 0 for help", () => {
      expect(run("--help").status).toBe(0);
      expect(run("git", "checkout", "--help").status).toBe(0);
    });
  });

  describe("argument handling", () => {
    it("preserves quoting the shell already resolved", () => {
      // Joined with spaces this is re-split by the remote shell and prints
      // something else entirely.
      const result = run("exec", "--", "node", "-e", 'console.log(["a b","c d"].join("|"))');
      expect(result.stdout.trim()).toBe("a b|c d");
    });

    it("treats a lone argument as a shell expression", () => {
      const result = run("exec", "--", "cd /tmp && pwd");
      expect(result.stdout.trim()).toBe("/tmp");
    });

    it("applies --cwd", () => {
      expect(run("exec", "-C", "/tmp", "--", "pwd").stdout.trim()).toBe("/tmp");
    });
  });

  describe("files", () => {
    it("writes from stdin and reads back the same bytes", () => {
      // The `-` form exists because source code does not survive shell
      // quoting, so the round trip is what matters.
      const source = 'const answer = 42;\nconsole.log("a b", answer);\n';
      expect(runWithStdin(source, "files", "write", "answer.js", "-").status).toBe(0);
      expect(run("files", "read", "answer.js").stdout).toBe(source);
      expect(run("exec", "--", "node", "answer.js").stdout.trim()).toBe("a b 42");
    });

    it("refuses to delete a directory without -r", () => {
      run("files", "mkdir", "-p", "tree/inner");
      expect(run("files", "remove", "tree").status).toBe(125);
      expect(run("files", "remove", "tree", "-r").status).toBe(0);
    });
  });

  describe("git", () => {
    beforeAll(() => {
      run("git", "clone", "https://github.com/octocat/Hello-World");
    }, 180_000);

    it("reports the workspace root as not a repository", () => {
      const result = run("git", "status");
      expect(result.status).toBe(125);
      expect(result.stderr).toContain("Not a git repository");
    });

    it("is silent and successful for a clean tree", () => {
      const result = run("git", "status", "-C", "Hello-World");
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("");
    });

    it("passes git's own exit code through", () => {
      // 128 is git's code for "not a repository".
      expect(run("git", "exec", "--", "rev-parse", "--abbrev-ref", "HEAD").status).toBe(128);
    });

    it("confirms the branch it actually landed on", () => {
      expect(run("git", "checkout", "-C", "Hello-World", "feature/it").stdout).toContain(
        "feature/it",
      );
      expect(
        run("git", "exec", "-C", "Hello-World", "--", "rev-parse", "--abbrev-ref", "HEAD").stdout,
      ).toContain("feature/it");
    });

    it("refuses to call restoring a file a branch switch", () => {
      // `git checkout README` succeeds and leaves HEAD alone; reporting that
      // as a switch sends a script on to work on the wrong branch.
      const result = run("git", "checkout", "-C", "Hello-World", "README");
      expect(result.status).toBe(125);
      expect(result.stderr).toContain("README");
    });
  });
});
