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

    it("clones into an explicit destination folder", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({}));

      // For clone the folder is where the repo lands, so it does not exist yet
      // and cd() cannot be used to express it.
      await box.git.clone({ repo: "owner/repo", folder: "my-app" });

      const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string);
      expect(body.folder).toBe("my-app");
    });

    it("prefers the explicit destination over the current directory", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ exit_code: 0, output: "" }));
      await box.cd("/workspace/home/elsewhere");
      fetchMock.mockResolvedValueOnce(mockResponse({}));

      await box.git.clone({ repo: "owner/repo", folder: "my-app" });

      const body = JSON.parse(fetchMock.mock.calls.at(-1)![1]?.body as string);
      expect(body.folder).toBe("my-app");
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
      // The coordinator serves this under config/git; asserting the old
      // "/git-config" spelling is what let the wrong path ship.
      expect(url).toContain("/config/git");
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
      expect(body.attach).toBeUndefined();
    });

    it("sends attachments and surfaces a warning", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(
        mockResponse({
          url: "https://github.com/owner/repo/pull/42",
          number: 42,
          title: "Fix",
          base: "main",
          warning: "failed to upload later.png",
        }),
      );

      const pr = await box.git.createPR({
        title: "Fix",
        attach: ["shot.png#the login error", "clip.mp4"],
      });
      expect(pr.warning).toBe("failed to upload later.png");

      const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string);
      expect(body.attach).toEqual(["shot.png#the login error", "clip.mp4"]);
    });

    it("omits an empty attach list", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(
        mockResponse({ url: "u", number: 1, title: "t", base: "main" }),
      );

      await box.git.createPR({ title: "Fix", attach: [] });
      const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string);
      expect(body.attach).toBeUndefined();
    });
  });

  describe("git.createIssue", () => {
    it("creates an issue", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(
        mockResponse({
          url: "https://github.com/owner/repo/issues/9",
          number: 9,
          title: "Bug",
        }),
      );

      const issue = await box.git.createIssue({ title: "Bug", body: "steps" });
      expect(issue.number).toBe(9);
      expect(issue.url).toContain("issues/9");
      expect(issue.warning).toBeUndefined();

      const call = fetchMock.mock.calls[1]!;
      expect(call[0]).toContain("/git/create-issue");
      const body = JSON.parse(call[1]?.body as string);
      expect(body.title).toBe("Bug");
      expect(body.body).toBe("steps");
      expect(body.base).toBeUndefined();
    });

    it("sends attachments", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ url: "u", number: 9, title: "Bug" }));

      await box.git.createIssue({ title: "Bug", attach: ["repro.png#the repro"] });
      const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string);
      expect(body.attach).toEqual(["repro.png#the repro"]);
    });
  });

  describe("git.exec", () => {
    it("executes a git command", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ output: "abc123\ndef456", exit_code: 0 }));

      const result = await box.git.exec({ args: ["log", "--oneline", "-2"] });
      expect(result.output).toBe("abc123\ndef456");
      expect(result.exit_code).toBe(0);

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/git/exec");
      const body = JSON.parse(init?.body as string);
      expect(body.args).toEqual(["log", "--oneline", "-2"]);
    });

    it("forwards git's exit code, so a failed command is distinguishable", async () => {
      const { box, fetchMock } = await createTestBox();
      // 128 is what git returns when the folder is not a repository.
      fetchMock.mockResolvedValueOnce(mockResponse({ output: "", exit_code: 128 }));

      const result = await box.git.exec({ args: ["rev-parse", "--is-inside-work-tree"] });
      expect(result.exit_code).toBe(128);
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
