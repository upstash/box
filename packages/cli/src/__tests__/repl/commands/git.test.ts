import { describe, it, expect, vi } from "vitest";
import { handleGit } from "../../../repl/commands/git.js";
import { collectEvents } from "../helpers.js";

describe("handleGit", () => {
  function createMockBox() {
    return {
      git: {
        clone: vi.fn().mockResolvedValue(undefined),
        diff: vi.fn().mockResolvedValue("+added line"),
        status: vi.fn().mockResolvedValue("M src/index.ts"),
        commit: vi.fn().mockResolvedValue({ sha: "abc123", message: "fix bug" }),
        push: vi.fn().mockResolvedValue(undefined),
        createPR: vi.fn().mockResolvedValue({ number: 42, url: "https://github.com/pr/42" }),
        exec: vi.fn().mockResolvedValue({ output: "git exec output" }),
        checkout: vi.fn().mockResolvedValue(undefined),
      },
    };
  }

  describe("clone", () => {
    it("clones a repo", async () => {
      const box = createMockBox();
      const events = await collectEvents(handleGit(box as any, "clone owner/repo"));
      expect(box.git.clone).toHaveBeenCalledWith({ repo: "owner/repo", branch: undefined });
      expect(events).toContainEqual({ type: "log", message: "Cloned owner/repo" });
    });

    it("clones with branch", async () => {
      const box = createMockBox();
      const events = await collectEvents(handleGit(box as any, "clone owner/repo dev"));
      expect(box.git.clone).toHaveBeenCalledWith({ repo: "owner/repo", branch: "dev" });
    });

    it("prints usage without repo", async () => {
      const events = await collectEvents(handleGit(createMockBox() as any, "clone"));
      expect(events).toContainEqual({ type: "log", message: "Usage: git clone <repo> [branch]" });
    });
  });

  describe("diff", () => {
    it("prints diff", async () => {
      const box = createMockBox();
      const events = await collectEvents(handleGit(box as any, "diff"));
      expect(events).toContainEqual({ type: "log", message: "+added line" });
    });

    it("prints no changes when diff is empty", async () => {
      const box = createMockBox();
      box.git.diff.mockResolvedValue("");
      const events = await collectEvents(handleGit(box as any, "diff"));
      expect(events).toContainEqual({ type: "log", message: "(no changes)" });
    });
  });

  describe("status", () => {
    it("prints status", async () => {
      const box = createMockBox();
      const events = await collectEvents(handleGit(box as any, "status"));
      expect(box.git.status).toHaveBeenCalled();
      expect(events).toContainEqual({ type: "log", message: "M src/index.ts" });
    });

    it("prints clean when status is empty", async () => {
      const box = createMockBox();
      box.git.status.mockResolvedValue("");
      const events = await collectEvents(handleGit(box as any, "status"));
      expect(events).toContainEqual({ type: "log", message: "(clean)" });
    });
  });

  describe("commit", () => {
    it("commits with message", async () => {
      const box = createMockBox();
      const events = await collectEvents(handleGit(box as any, "commit fix bug"));
      expect(box.git.commit).toHaveBeenCalledWith({ message: "fix bug" });
      expect(events).toContainEqual({ type: "log", message: "Committed abc123: fix bug" });
    });

    it("prints usage without message", async () => {
      const events = await collectEvents(handleGit(createMockBox() as any, "commit"));
      expect(events).toContainEqual({ type: "log", message: "Usage: git commit <message>" });
    });
  });

  describe("push", () => {
    it("pushes to default branch", async () => {
      const box = createMockBox();
      const events = await collectEvents(handleGit(box as any, "push"));
      expect(box.git.push).toHaveBeenCalledWith(undefined);
      expect(events).toContainEqual({ type: "log", message: "Pushed" });
    });

    it("pushes to specific branch", async () => {
      const box = createMockBox();
      const events = await collectEvents(handleGit(box as any, "push feature"));
      expect(box.git.push).toHaveBeenCalledWith({ branch: "feature" });
      expect(events).toContainEqual({ type: "log", message: "Pushed to feature" });
    });
  });

  describe("create-pr", () => {
    it("creates a PR and prints details", async () => {
      const box = createMockBox();
      const events = await collectEvents(handleGit(box as any, "create-pr Fix the bug"));
      expect(box.git.createPR).toHaveBeenCalledWith({ title: "Fix the bug" });
      expect(events).toContainEqual({ type: "log", message: "PR #42: https://github.com/pr/42" });
    });

    it("prints usage without title", async () => {
      const events = await collectEvents(handleGit(createMockBox() as any, "create-pr"));
      expect(events).toContainEqual({ type: "log", message: "Usage: git create-pr <title>" });
    });
  });

  describe("exec", () => {
    it("executes a git command", async () => {
      const box = createMockBox();
      const events = await collectEvents(handleGit(box as any, "exec log --oneline -2"));
      expect(box.git.exec).toHaveBeenCalledWith({ args: ["log", "--oneline", "-2"] });
      expect(events).toContainEqual({ type: "log", message: "git exec output" });
    });

    it("prints usage without args", async () => {
      const events = await collectEvents(handleGit(createMockBox() as any, "exec"));
      expect(events).toContainEqual({ type: "log", message: "Usage: git exec <args...>" });
    });

    it("prints no output when result is empty", async () => {
      const box = createMockBox();
      box.git.exec.mockResolvedValue({ output: "" });
      const events = await collectEvents(handleGit(box as any, "exec status"));
      expect(events).toContainEqual({ type: "log", message: "(no output)" });
    });
  });

  describe("checkout", () => {
    it("checks out a branch", async () => {
      const box = createMockBox();
      const events = await collectEvents(handleGit(box as any, "checkout feature"));
      expect(box.git.checkout).toHaveBeenCalledWith({ branch: "feature" });
      expect(events).toContainEqual({ type: "log", message: "Switched to branch feature" });
    });

    it("prints usage without branch", async () => {
      const events = await collectEvents(handleGit(createMockBox() as any, "checkout"));
      expect(events).toContainEqual({ type: "log", message: "Usage: git checkout <branch>" });
    });
  });

  describe("unknown subcommand", () => {
    it("prints usage", async () => {
      const events = await collectEvents(handleGit(createMockBox() as any, ""));
      expect(events).toContainEqual(
        expect.objectContaining({ type: "log", message: expect.stringContaining("Usage: git") }),
      );
    });
  });
});
