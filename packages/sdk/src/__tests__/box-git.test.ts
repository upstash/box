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

    it("clones a repo with depth", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({}));

      await box.git.clone({ repo: "owner/repo", depth: 1 });

      const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string);
      expect(body.depth).toBe(1);
    });

    it("omits depth when not provided", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({}));

      await box.git.clone({ repo: "owner/repo" });

      const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string);
      expect(body).not.toHaveProperty("depth");
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

    it("sends author override fields", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ sha: "abc123", message: "fix bug" }));

      await box.git.commit({
        message: "fix bug",
        authorName: "Jane Doe",
        authorEmail: "jane@example.com",
      });

      const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string);
      expect(body.message).toBe("fix bug");
      expect(body.author_name).toBe("Jane Doe");
      expect(body.author_email).toBe("jane@example.com");
    });
  });

  describe("git.updateConfig", () => {
    it("updates git config and returns effective values", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(
        mockResponse({ git_user_name: "John Doe", git_user_email: "john@example.com" }),
      );

      const result = await box.git.updateConfig({
        userName: "John Doe",
        userEmail: "john@example.com",
      });

      expect(result).toEqual({
        git_user_name: "John Doe",
        git_user_email: "john@example.com",
      });

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/git-config");
      expect(init?.method).toBe("PUT");
      const body = JSON.parse(init?.body as string);
      expect(body.git_user_name).toBe("John Doe");
      expect(body.git_user_email).toBe("john@example.com");
    });

    it("throws when both fields are omitted", async () => {
      const { box } = await createTestBox();
      await expect(box.git.updateConfig({})).rejects.toThrow(
        "At least one of userName or userEmail is required",
      );
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
  });
});
