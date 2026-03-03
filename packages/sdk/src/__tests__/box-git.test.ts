import { describe, it, expect, vi, afterEach } from "vitest";
import { mockResponse, createTestBox } from "./helpers.js";

describe("Box git operations", () => {
  afterEach(() => vi.restoreAllMocks());

  describe("git.clone", () => {
    it("clones a repo", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({}));

      await box.git.clone({ repo: "owner/repo" });

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/git/clone");
      const body = JSON.parse(init?.body as string);
      expect(body.repo).toBe("owner/repo");
    });

    it("clones a repo with branch", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({}));

      await box.git.clone({ repo: "owner/repo", branch: "dev" });

      const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string);
      expect(body.branch).toBe("dev");
    });
  });

  describe("git.diff", () => {
    it("returns diff", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ diff: "+new line\n-old line" }));

      const diff = await box.git.diff();
      expect(diff).toBe("+new line\n-old line");
    });
  });

  describe("git.status", () => {
    it("returns status", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ status: "M src/index.ts" }));

      const status = await box.git.status();
      expect(status).toBe("M src/index.ts");
    });
  });

  describe("git.commit", () => {
    it("commits and returns result", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ sha: "abc123", message: "fix bug" }));

      const result = await box.git.commit({ message: "fix bug" });
      expect(result.sha).toBe("abc123");
      expect(result.message).toBe("fix bug");
    });
  });

  describe("git.push", () => {
    it("pushes to default branch", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({}));

      await box.git.push();
      const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string);
      expect(body.branch).toBeUndefined();
    });

    it("pushes to specific branch", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({}));

      await box.git.push({ branch: "feature" });
      const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string);
      expect(body.branch).toBe("feature");
    });
  });

  describe("git.createPR", () => {
    it("creates a pull request", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(
        mockResponse({
          url: "https://github.com/owner/repo/pull/42",
          number: 42,
          title: "Fix",
          base: "main",
        }),
      );

      const pr = await box.git.createPR({ title: "Fix", body: "desc", base: "main" });
      expect(pr.number).toBe(42);
      expect(pr.url).toContain("pull/42");

      const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string);
      expect(body.title).toBe("Fix");
      expect(body.body).toBe("desc");
      expect(body.base).toBe("main");
    });
  });

  describe("git.exec", () => {
    it("executes a git command", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ output: "abc123\ndef456" }));

      const result = await box.git.exec({ args: ["log", "--oneline", "-2"] });
      expect(result.output).toBe("abc123\ndef456");

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/git/exec");
      const body = JSON.parse(init?.body as string);
      expect(body.args).toEqual(["log", "--oneline", "-2"]);
    });

    it("passes folder option", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ output: "" }));

      await box.git.exec({ args: ["status"], folder: "/workspace/project" });

      const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string);
      expect(body.folder).toBe("/workspace/project");
    });
  });

  describe("git.checkout", () => {
    it("checks out a branch", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({}));

      await box.git.checkout({ branch: "feature" });

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/git/checkout");
      const body = JSON.parse(init?.body as string);
      expect(body.branch).toBe("feature");
    });

    it("passes folder option", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({}));

      await box.git.checkout({ branch: "main", folder: "/workspace/project" });

      const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string);
      expect(body.branch).toBe("main");
      expect(body.folder).toBe("/workspace/project");
    });
  });
});
