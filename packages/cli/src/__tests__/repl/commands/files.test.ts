import { describe, it, expect, vi } from "vitest";
import { handleFiles } from "../../../repl/commands/files.js";
import type { REPLHooks } from "../../../repl/client.js";

function createHooks() {
  return {
    onLog: vi.fn() as unknown as REPLHooks["onLog"],
    onError: vi.fn() as unknown as REPLHooks["onError"],
    onStream: vi.fn() as unknown as REPLHooks["onStream"],
  };
}

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
      const hooks = createHooks();
      await handleFiles(box as any, "read app.ts", hooks);
      expect(box.files.read).toHaveBeenCalledWith("app.ts");
      expect(hooks.onLog).toHaveBeenCalledWith("file content");
    });

    it("prints usage without path", async () => {
      const hooks = createHooks();
      await handleFiles(createMockBox() as any, "read", hooks);
      expect(hooks.onLog).toHaveBeenCalledWith("Usage: files read <path>");
    });
  });

  describe("write", () => {
    it("writes file content", async () => {
      const box = createMockBox();
      const hooks = createHooks();
      await handleFiles(box as any, "write hello.txt hello world", hooks);
      expect(box.files.write).toHaveBeenCalledWith({ path: "hello.txt", content: "hello world" });
      expect(hooks.onLog).toHaveBeenCalledWith("Written to hello.txt");
    });

    it("prints usage without args", async () => {
      const hooks = createHooks();
      await handleFiles(createMockBox() as any, "write", hooks);
      expect(hooks.onLog).toHaveBeenCalledWith("Usage: files write <path> <content>");
    });
  });

  describe("list", () => {
    it("lists files with directory indicator", async () => {
      const box = createMockBox();
      const hooks = createHooks();
      await handleFiles(box as any, "list", hooks);
      expect(hooks.onLog).toHaveBeenCalledWith("src/\t0");
      expect(hooks.onLog).toHaveBeenCalledWith("index.ts\t100");
    });
  });

  describe("upload", () => {
    it("uploads a file", async () => {
      const box = createMockBox();
      const hooks = createHooks();
      await handleFiles(box as any, "upload ./local.txt remote.txt", hooks);
      expect(box.files.upload).toHaveBeenCalledWith([
        { path: "./local.txt", destination: "remote.txt" },
      ]);
      expect(hooks.onLog).toHaveBeenCalledWith(expect.stringContaining("Uploaded"));
    });

    it("prints usage without args", async () => {
      const hooks = createHooks();
      await handleFiles(createMockBox() as any, "upload", hooks);
      expect(hooks.onLog).toHaveBeenCalledWith("Usage: files upload <local-path> <destination>");
    });
  });

  describe("download", () => {
    it("downloads files", async () => {
      const box = createMockBox();
      const hooks = createHooks();
      await handleFiles(box as any, "download /work", hooks);
      expect(box.files.download).toHaveBeenCalledWith({ path: "/work" });
      expect(hooks.onLog).toHaveBeenCalledWith("Downloaded.");
    });

    it("downloads without path", async () => {
      const box = createMockBox();
      const hooks = createHooks();
      await handleFiles(box as any, "download", hooks);
      expect(box.files.download).toHaveBeenCalledWith(undefined);
    });
  });

  describe("unknown subcommand", () => {
    it("prints usage", async () => {
      const hooks = createHooks();
      await handleFiles(createMockBox() as any, "", hooks);
      expect(hooks.onLog).toHaveBeenCalledWith(expect.stringContaining("Usage: files"));
    });
  });
});
