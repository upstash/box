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
        stat: vi.fn().mockResolvedValue({
          type: "file",
          size: 12,
          mod_time: "2026-01-01T00:00:00Z",
          inode: 42,
          version: "v1",
        }),
        mkdir: vi.fn().mockResolvedValue(undefined),
        rename: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
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
      expect(events).toContainEqual({
        type: "log",
        message: "Usage: files write <path> <content>",
      });
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
      expect(events).toContainEqual(
        expect.objectContaining({ type: "log", message: expect.stringContaining("Uploaded") }),
      );
    });

    it("prints usage without args", async () => {
      const events = await collectEvents(handleFiles(createMockBox() as any, "upload"));
      expect(events).toContainEqual({
        type: "log",
        message: "Usage: files upload <local-path> <destination>",
      });
    });
  });

  describe("download", () => {
    it("downloads files", async () => {
      const box = createMockBox();
      const events = await collectEvents(handleFiles(box as any, "download /work"));
      expect(box.files.download).toHaveBeenCalledWith({ folder: "/work" });
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
      expect(events).toContainEqual(
        expect.objectContaining({ type: "log", message: expect.stringContaining("Usage: files") }),
      );
    });
  });

  describe("stat", () => {
    it("prints type, size, time and inode", async () => {
      const box = createMockBox();
      const events = await collectEvents(handleFiles(box as any, "stat app.ts"));
      expect(box.files.stat).toHaveBeenCalledWith("app.ts", undefined);
      expect(events[0]).toEqual({
        type: "log",
        message: "file\t12\t2026-01-01T00:00:00Z\tinode 42",
      });
    });

    it("passes --follow however it is ordered", async () => {
      const box = createMockBox();
      await collectEvents(handleFiles(box as any, "stat --follow link.ts"));
      // The flag before the path is the Unix spelling; reading the path from a
      // fixed index would take "--follow" as the path here.
      expect(box.files.stat).toHaveBeenCalledWith("link.ts", { follow: true });
    });

    it("prints usage without a path", async () => {
      const events = await collectEvents(handleFiles(createMockBox() as any, "stat"));
      expect(events[0]?.message).toContain("Usage: files stat");
    });
  });

  describe("mkdir", () => {
    it("creates a directory", async () => {
      const box = createMockBox();
      await collectEvents(handleFiles(box as any, "mkdir build"));
      expect(box.files.mkdir).toHaveBeenCalledWith("build", undefined);
    });

    it("accepts -p before the path", async () => {
      const box = createMockBox();
      await collectEvents(handleFiles(box as any, "mkdir -p a/b/c"));
      expect(box.files.mkdir).toHaveBeenCalledWith("a/b/c", { parents: true });
    });
  });

  describe("rename", () => {
    it("moves a path and accepts the mv alias", async () => {
      const box = createMockBox();
      await collectEvents(handleFiles(box as any, "mv old.txt new.txt"));
      expect(box.files.rename).toHaveBeenCalledWith("old.txt", "new.txt");
    });

    it("prints usage when the destination is missing", async () => {
      const events = await collectEvents(handleFiles(createMockBox() as any, "rename only.txt"));
      expect(events[0]?.message).toContain("Usage: files rename");
    });
  });

  describe("remove", () => {
    it("removes without recursion by default", async () => {
      const box = createMockBox();
      await collectEvents(handleFiles(box as any, "remove note.txt"));
      expect(box.files.remove).toHaveBeenCalledWith("note.txt", undefined);
    });

    it("accepts -r before the path", async () => {
      const box = createMockBox();
      await collectEvents(handleFiles(box as any, "rm -r build"));
      expect(box.files.remove).toHaveBeenCalledWith("build", { recursive: true });
    });
  });

  describe("usage", () => {
    it("lists every verb it accepts", async () => {
      const events = await collectEvents(handleFiles(createMockBox() as any, "nope"));
      const message = String(events[0]?.message);
      for (const verb of [
        "read",
        "write",
        "list",
        "stat",
        "mkdir",
        "rename",
        "remove",
        "upload",
        "download",
      ]) {
        expect(message).toContain(verb);
      }
    });
  });
});
