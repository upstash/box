import { describe, it, expect, vi, afterEach } from "vitest";
import { mockResponse, createTestBox } from "./helpers.js";

describe("Box file operations", () => {
  afterEach(() => vi.restoreAllMocks());

  describe("files.read", () => {
    it("reads a file with relative path", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ content: "file content" }));

      const content = await box.files.read("app.ts");
      expect(content).toBe("file content");

      const [url] = fetchMock.mock.calls[1]!;
      expect(url).toContain(encodeURIComponent("/workspace/home/app.ts"));
    });

    it("reads a file with absolute path", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ content: "root file" }));

      const content = await box.files.read("/etc/config");
      expect(content).toBe("root file");

      const [url] = fetchMock.mock.calls[1]!;
      expect(url).toContain(encodeURIComponent("/etc/config"));
    });

    it("reads a file with base64 encoding", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ content: "aGVsbG8=" }));

      const content = await box.files.read("image.png", { encoding: "base64" });
      expect(content).toBe("aGVsbG8=");

      const [url] = fetchMock.mock.calls[1]!;
      expect(url).toContain("encoding=base64");
    });

    it("does not send encoding param when not specified", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ content: "plain" }));

      await box.files.read("file.txt");

      const [url] = fetchMock.mock.calls[1]!;
      expect(url).not.toContain("encoding");
    });
  });

  describe("files.write", () => {
    it("writes a file with relative path", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({}));

      await box.files.write({ path: "hello.txt", content: "hello" });

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/files/write");
      const body = JSON.parse(init?.body as string);
      expect(body.path).toBe("/workspace/home/hello.txt");
      expect(body.content).toBe("hello");
    });

    it("writes a file with absolute path", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({}));

      await box.files.write({ path: "/tmp/test.txt", content: "data" });

      const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string);
      expect(body.path).toBe("/tmp/test.txt");
    });
  });

  describe("files.list", () => {
    it("lists files with relative path", async () => {
      const { box, fetchMock } = await createTestBox();
      const files = [
        { name: "src", path: "/workspace/home/src", size: 0, is_dir: true, mod_time: "" },
        {
          name: "index.ts",
          path: "/workspace/home/index.ts",
          size: 100,
          is_dir: false,
          mod_time: "",
        },
      ];
      fetchMock.mockResolvedValueOnce(mockResponse({ files }));

      const result = await box.files.list(".");
      expect(result).toHaveLength(2);
      expect(result[0]!.is_dir).toBe(true);
    });

    it("lists files without path", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ files: [] }));

      const result = await box.files.list();
      expect(result).toEqual([]);

      const [url] = fetchMock.mock.calls[1]!;
      expect(url).not.toContain("path=");
    });
  });

  describe("files.read range", () => {
    it("sends offset and length for a bounded read", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ content: "partial" }));

      const out = await box.files.read("big.log", { offset: 100, length: 50 });
      expect(out).toBe("partial");

      const [url] = fetchMock.mock.calls[1]!;
      expect(url).toContain("offset=100");
      expect(url).toContain("length=50");
    });

    it("sends an explicit length=0 instead of falling back to a whole-file read", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ content: "" }));

      const out = await box.files.read("big.log", { length: 0 });
      expect(out).toBe("");

      const [url] = fetchMock.mock.calls[1]!;
      expect(url).toContain("length=0");
    });

    it("omits range params for a whole-file read", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ content: "whole" }));
      await box.files.read("f.txt");
      const [url] = fetchMock.mock.calls[1]!;
      expect(url).not.toContain("length=");
    });
  });

  describe("files.stat", () => {
    it("stats a path (lstat by default) and returns metadata", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(
        mockResponse({
          type: "file",
          size: 12,
          mod_time: "2026-08-19T11:56:59Z",
          inode: 42,
          version: "42-1787-12",
        }),
      );

      const st = await box.files.stat("a.txt");
      expect(st.type).toBe("file");
      expect(st.size).toBe(12);
      expect(st.version).toBe("42-1787-12");

      const [url] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/files/stat");
      expect(url).toContain(encodeURIComponent("/workspace/home/a.txt"));
      expect(url).not.toContain("follow=true");
    });

    it("sends follow=true when requested", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ type: "file", size: 0, mod_time: "", inode: 1, version: "1" }));

      await box.files.stat("/link", { follow: true });
      const [url] = fetchMock.mock.calls[1]!;
      expect(url).toContain("follow=true");
    });
  });

  describe("files.mkdir", () => {
    it("creates a directory with parents", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({ path: "/workspace/home/a/b" }));

      await box.files.mkdir("a/b", { parents: true });

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/files/mkdir");
      const body = JSON.parse(init?.body as string);
      expect(body.path).toBe("/workspace/home/a/b");
      expect(body.parents).toBe(true);
    });

    it("defaults parents to false", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({}));

      await box.files.mkdir("dir");
      const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string);
      expect(body.parents).toBe(false);
    });
  });

  describe("files.rename", () => {
    it("renames resolving both paths", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({}));

      await box.files.rename("a.txt", "b.txt");

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/files/rename");
      const body = JSON.parse(init?.body as string);
      expect(body.from).toBe("/workspace/home/a.txt");
      expect(body.to).toBe("/workspace/home/b.txt");
    });
  });

  describe("files.remove", () => {
    it("removes recursively when requested", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({}));

      await box.files.remove("dir", { recursive: true });

      const [url, init] = fetchMock.mock.calls[1]!;
      expect(url).toContain("/files/remove");
      const body = JSON.parse(init?.body as string);
      expect(body.path).toBe("/workspace/home/dir");
      expect(body.recursive).toBe(true);
    });

    it("defaults recursive to false", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockResponse({}));

      await box.files.remove("f.txt");
      const body = JSON.parse(fetchMock.mock.calls[1]![1]?.body as string);
      expect(body.recursive).toBe(false);
    });
  });
});
