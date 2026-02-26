import { describe, it, expect, vi } from "vitest";
import { handleGit } from "../../../repl/commands/git.js";
import { collectEvents } from "../helpers.js";

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

  describe("unknown subcommand", () => {
    it("prints usage", async () => {
      const events = await collectEvents(handleGit(createMockBox() as any, ""));
      expect(events).toContainEqual(
        expect.objectContaining({ type: "log", message: expect.stringContaining("Usage: git") }),
      );
    });
  });
});
