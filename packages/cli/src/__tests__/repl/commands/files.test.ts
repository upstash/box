import { describe, it, expect, vi } from "vitest";
import { handleFiles } from "../../../repl/commands/files.js";
import { collectEvents } from "../helpers.js";

describe("handleFiles", () => {
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
      const events = await collectEvents(handleFiles(box as any, "read app.ts"));
      expect(box.files.read).toHaveBeenCalledWith("app.ts");
      expect(events).toContainEqual({ type: "log", message: "file content" });
    });

    it("prints usage without path", async () => {
      const events = await collectEvents(handleFiles(createMockBox() as any, "read"));
      expect(events).toContainEqual({ type: "log", message: "Usage: files read <path>" });
    });
  });

  describe("write", () => {
    it("writes file content", async () => {
      const box = createMockBox();
      const events = await collectEvents(handleFiles(box as any, "write hello.txt hello world"));
      expect(box.files.write).toHaveBeenCalledWith({ path: "hello.txt", content: "hello world" });
      expect(events).toContainEqual({ type: "log", message: "Written to hello.txt" });
    });

    it("prints usage without args", async () => {
      const events = await collectEvents(handleFiles(createMockBox() as any, "write"));
      expect(events).toContainEqual({ type: "log", message: "Usage: files write <path> <content>" });
    });
  });

  describe("list", () => {
    it("lists files with directory indicator", async () => {
      const box = createMockBox();
      const events = await collectEvents(handleFiles(box as any, "list"));
      expect(events).toContainEqual({ type: "log", message: "src/\t0" });
      expect(events).toContainEqual({ type: "log", message: "index.ts\t100" });
    });
  });

  describe("upload", () => {
    it("uploads a file", async () => {
      const box = createMockBox();
      const events = await collectEvents(handleFiles(box as any, "upload ./local.txt remote.txt"));
      expect(box.files.upload).toHaveBeenCalledWith([
        { path: "./local.txt", destination: "remote.txt" },
      ]);
      expect(events).toContainEqual(expect.objectContaining({ type: "log", message: expect.stringContaining("Uploaded") }));
    });

    it("prints usage without args", async () => {
      const events = await collectEvents(handleFiles(createMockBox() as any, "upload"));
      expect(events).toContainEqual({ type: "log", message: "Usage: files upload <local-path> <destination>" });
    });
  });

  describe("download", () => {
    it("downloads files", async () => {
      const box = createMockBox();
      const events = await collectEvents(handleFiles(box as any, "download /work"));
      expect(box.files.download).toHaveBeenCalledWith({ path: "/work" });
      expect(events).toContainEqual({ type: "log", message: "Downloaded." });
    });

    it("downloads without path", async () => {
      const box = createMockBox();
      const events = await collectEvents(handleFiles(box as any, "download"));
      expect(box.files.download).toHaveBeenCalledWith(undefined);
    });
  });

  describe("unknown subcommand", () => {
    it("prints usage", async () => {
      const events = await collectEvents(handleFiles(createMockBox() as any, ""));
      expect(events).toContainEqual(expect.objectContaining({ type: "log", message: expect.stringContaining("Usage: files") }));
    });
  });
});
