import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleGit } from "../../repl-commands/git.js";

describe("handleGit", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

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
      await handleGit(box as any, "clone owner/repo");
      expect(box.git.clone).toHaveBeenCalledWith({ repo: "owner/repo", branch: undefined });
      expect(logSpy).toHaveBeenCalledWith("Cloned owner/repo");
    });

    it("clones with branch", async () => {
      const box = createMockBox();
      await handleGit(box as any, "clone owner/repo dev");
      expect(box.git.clone).toHaveBeenCalledWith({ repo: "owner/repo", branch: "dev" });
    });

    it("prints usage without repo", async () => {
      await handleGit(createMockBox() as any, "clone");
      expect(logSpy).toHaveBeenCalledWith("Usage: git clone <repo> [branch]");
    });
  });

  describe("diff", () => {
    it("prints diff", async () => {
      const box = createMockBox();
      await handleGit(box as any, "diff");
      expect(logSpy).toHaveBeenCalledWith("+added line");
    });

    it("prints no changes when diff is empty", async () => {
      const box = createMockBox();
      box.git.diff.mockResolvedValue("");
      await handleGit(box as any, "diff");
      expect(logSpy).toHaveBeenCalledWith("(no changes)");
    });
  });

  describe("create-pr", () => {
    it("creates a PR and prints details", async () => {
      const box = createMockBox();
      await handleGit(box as any, "create-pr Fix the bug");
      expect(box.git.createPR).toHaveBeenCalledWith({ title: "Fix the bug" });
      expect(logSpy).toHaveBeenCalledWith("PR #42: https://github.com/pr/42");
    });

    it("prints usage without title", async () => {
      await handleGit(createMockBox() as any, "create-pr");
      expect(logSpy).toHaveBeenCalledWith("Usage: git create-pr <title>");
    });
  });

  describe("unknown subcommand", () => {
    it("prints usage", async () => {
      await handleGit(createMockBox() as any, "");
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Usage: git"));
    });
  });
});
