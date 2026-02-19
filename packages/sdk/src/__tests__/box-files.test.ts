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
        { name: "index.ts", path: "/workspace/home/index.ts", size: 100, is_dir: false, mod_time: "" },
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
});
