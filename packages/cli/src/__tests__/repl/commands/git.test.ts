import { describe, it, expect, vi } from "vitest";
import { handleGit } from "../../../repl/commands/git.js";
import type { REPLHooks } from "../../../repl/client.js";

function createHooks() {
  return {
    onLog: vi.fn() as unknown as REPLHooks["onLog"],
    onError: vi.fn() as unknown as REPLHooks["onError"],
    onStream: vi.fn() as unknown as REPLHooks["onStream"],
  };
}

describe("handleGit", () => {
  function createMockBox() {
    return {
      git: {
        clone: vi.fn().mockResolvedValue(undefined),
        diff: vi.fn().mockResolvedValue("+added line"),
        createPR: vi.fn().mockResolvedValue({ number: 42, url: "https://github.com/pr/42" }),
      },
    };
  }

  describe("clone", () => {
    it("clones a repo", async () => {
      const box = createMockBox();
      const hooks = createHooks();
      await handleGit(box as any, "clone owner/repo", hooks);
      expect(box.git.clone).toHaveBeenCalledWith({ repo: "owner/repo", branch: undefined });
      expect(hooks.onLog).toHaveBeenCalledWith("Cloned owner/repo");
    });

    it("clones with branch", async () => {
      const box = createMockBox();
      const hooks = createHooks();
      await handleGit(box as any, "clone owner/repo dev", hooks);
      expect(box.git.clone).toHaveBeenCalledWith({ repo: "owner/repo", branch: "dev" });
    });

    it("prints usage without repo", async () => {
      const hooks = createHooks();
      await handleGit(createMockBox() as any, "clone", hooks);
      expect(hooks.onLog).toHaveBeenCalledWith("Usage: git clone <repo> [branch]");
    });
  });

  describe("diff", () => {
    it("prints diff", async () => {
      const box = createMockBox();
      const hooks = createHooks();
      await handleGit(box as any, "diff", hooks);
      expect(hooks.onLog).toHaveBeenCalledWith("+added line");
    });

    it("prints no changes when diff is empty", async () => {
      const box = createMockBox();
      box.git.diff.mockResolvedValue("");
      const hooks = createHooks();
      await handleGit(box as any, "diff", hooks);
      expect(hooks.onLog).toHaveBeenCalledWith("(no changes)");
    });
  });

  describe("create-pr", () => {
    it("creates a PR and prints details", async () => {
      const box = createMockBox();
      const hooks = createHooks();
      await handleGit(box as any, "create-pr Fix the bug", hooks);
      expect(box.git.createPR).toHaveBeenCalledWith({ title: "Fix the bug" });
      expect(hooks.onLog).toHaveBeenCalledWith("PR #42: https://github.com/pr/42");
    });

    it("prints usage without title", async () => {
      const hooks = createHooks();
      await handleGit(createMockBox() as any, "create-pr", hooks);
      expect(hooks.onLog).toHaveBeenCalledWith("Usage: git create-pr <title>");
    });
  });

  describe("unknown subcommand", () => {
    it("prints usage", async () => {
      const hooks = createHooks();
      await handleGit(createMockBox() as any, "", hooks);
      expect(hooks.onLog).toHaveBeenCalledWith(expect.stringContaining("Usage: git"));
    });
  });
});
