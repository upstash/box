import { describe, it, expect, vi, afterEach } from "vitest";
import { mockResponse, createTestBox } from "./helpers.js";

/** Matches `_ensureAwake()` → `_execCommand("pwd")` before file API calls */
function mockWakeExec(): Response {
  return mockResponse({ exit_code: 0, output: "/workspace/home\n" });
}

describe("Box file operations", () => {
  afterEach(() => vi.restoreAllMocks());

  describe("files.read", () => {
    it("reads a file with relative path", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockWakeExec());
      fetchMock.mockResolvedValueOnce(mockResponse({ content: "file content" }));

      const content = await box.files.read("app.ts");
      expect(content).toBe("file content");

      const [wakeUrl, wakeInit] = fetchMock.mock.calls[1]!;
      expect(String(wakeUrl)).toContain("/exec");
      expect(JSON.parse(wakeInit?.body as string).command).toEqual(["sh", "-c", "pwd"]);

      const [url] = fetchMock.mock.calls[2]!;
      expect(url).toContain(encodeURIComponent("/workspace/home/app.ts"));
    });

    it("reads a file with absolute path", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockWakeExec());
      fetchMock.mockResolvedValueOnce(mockResponse({ content: "root file" }));

      const content = await box.files.read("/etc/config");
      expect(content).toBe("root file");

      const [url] = fetchMock.mock.calls[2]!;
      expect(url).toContain(encodeURIComponent("/etc/config"));
    });

    it("reads a file with base64 encoding", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockWakeExec());
      fetchMock.mockResolvedValueOnce(mockResponse({ content: "aGVsbG8=" }));

      const content = await box.files.read("image.png", { encoding: "base64" });
      expect(content).toBe("aGVsbG8=");

      const [url] = fetchMock.mock.calls[2]!;
      expect(url).toContain("encoding=base64");
    });

    it("does not send encoding param when not specified", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockWakeExec());
      fetchMock.mockResolvedValueOnce(mockResponse({ content: "plain" }));

      await box.files.read("file.txt");

      const [url] = fetchMock.mock.calls[2]!;
      expect(url).not.toContain("encoding");
    });
  });

  describe("files.write", () => {
    it("writes a file with relative path", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockWakeExec());
      fetchMock.mockResolvedValueOnce(mockResponse({}));

      await box.files.write({ path: "hello.txt", content: "hello" });

      const [url, init] = fetchMock.mock.calls[2]!;
      expect(url).toContain("/files/write");
      const body = JSON.parse(init?.body as string);
      expect(body.path).toBe("/workspace/home/hello.txt");
      expect(body.content).toBe("hello");
    });

    it("writes a file with absolute path", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockWakeExec());
      fetchMock.mockResolvedValueOnce(mockResponse({}));

      await box.files.write({ path: "/tmp/test.txt", content: "data" });

      const body = JSON.parse(fetchMock.mock.calls[2]![1]?.body as string);
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
      fetchMock.mockResolvedValueOnce(mockWakeExec());
      fetchMock.mockResolvedValueOnce(mockResponse({ files }));

      const result = await box.files.list(".");
      expect(result).toHaveLength(2);
      expect(result[0]!.is_dir).toBe(true);
    });

    it("lists files without path", async () => {
      const { box, fetchMock } = await createTestBox();
      fetchMock.mockResolvedValueOnce(mockWakeExec());
      fetchMock.mockResolvedValueOnce(mockResponse({ files: [] }));

      const result = await box.files.list();
      expect(result).toEqual([]);

      const [url] = fetchMock.mock.calls[2]!;
      expect(url).not.toContain("path=");
    });
  });
});
