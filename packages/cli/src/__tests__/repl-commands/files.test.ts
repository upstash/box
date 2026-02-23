import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleFiles } from "../../repl-commands/files.js";

describe("handleFiles", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => vi.restoreAllMocks());

  function createMockBox() {
    return {
      files: {
        read: vi.fn().mockResolvedValue("file content"),
        write: vi.fn().mockResolvedValue(undefined),
        list: vi.fn().mockResolvedValue([
          { name: "src", path: "/src", size: 0, is_dir: true, mod_time: "" },
          { name: "index.ts", path: "/index.ts", size: 100, is_dir: false, mod_time: "" },
        ]),
        upload: vi.fn().mockResolvedValue(undefined),
        download: vi.fn().mockResolvedValue(undefined),
      },
    };
  }

  describe("read", () => {
    it("reads and prints file content", async () => {
      const box = createMockBox();
      await handleFiles(box as any, "read app.ts");
      expect(box.files.read).toHaveBeenCalledWith("app.ts");
      expect(logSpy).toHaveBeenCalledWith("file content");
    });

    it("prints usage without path", async () => {
      await handleFiles(createMockBox() as any, "read");
      expect(logSpy).toHaveBeenCalledWith("Usage: files read <path>");
    });
  });

  describe("write", () => {
    it("writes file content", async () => {
      const box = createMockBox();
      await handleFiles(box as any, "write hello.txt hello world");
      expect(box.files.write).toHaveBeenCalledWith({ path: "hello.txt", content: "hello world" });
      expect(logSpy).toHaveBeenCalledWith("Written to hello.txt");
    });

    it("prints usage without args", async () => {
      await handleFiles(createMockBox() as any, "write");
      expect(logSpy).toHaveBeenCalledWith("Usage: files write <path> <content>");
    });
  });

  describe("list", () => {
    it("lists files with directory indicator", async () => {
      const box = createMockBox();
      await handleFiles(box as any, "list");
      expect(logSpy).toHaveBeenCalledWith("src/\t0");
      expect(logSpy).toHaveBeenCalledWith("index.ts\t100");
    });
  });

  describe("upload", () => {
    it("uploads a file", async () => {
      const box = createMockBox();
      await handleFiles(box as any, "upload ./local.txt remote.txt");
      expect(box.files.upload).toHaveBeenCalledWith([
        { path: "./local.txt", destination: "remote.txt" },
      ]);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Uploaded"));
    });

    it("prints usage without args", async () => {
      await handleFiles(createMockBox() as any, "upload");
      expect(logSpy).toHaveBeenCalledWith("Usage: files upload <local-path> <destination>");
    });
  });

  describe("download", () => {
    it("downloads files", async () => {
      const box = createMockBox();
      await handleFiles(box as any, "download /work");
      expect(box.files.download).toHaveBeenCalledWith({ path: "/work" });
      expect(logSpy).toHaveBeenCalledWith("Downloaded.");
    });

    it("downloads without path", async () => {
      const box = createMockBox();
      await handleFiles(box as any, "download");
      expect(box.files.download).toHaveBeenCalledWith(undefined);
    });
  });

  describe("unknown subcommand", () => {
    it("prints usage", async () => {
      await handleFiles(createMockBox() as any, "");
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Usage: files"));
    });
  });
});
