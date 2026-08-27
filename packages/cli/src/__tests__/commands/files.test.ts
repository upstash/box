import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  filesListCommand,
  filesMkdirCommand,
  filesReadCommand,
  filesRemoveCommand,
  filesRenameCommand,
  filesStatCommand,
  filesWriteCommand,
} from "../../commands/files.js";
import { CliError } from "../../core/errors.js";

const getBox = vi.hoisted(() => vi.fn());
vi.mock("@upstash/box", () => ({ Box: { get: getBox } }));

const readFileSync = vi.hoisted(() => vi.fn());
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  readFileSync,
}));

describe("box files", () => {
  let stdout: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    process.env.UPSTASH_BOX_API_KEY = "box_test";
    getBox.mockReset();
    readFileSync.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  const out = () => stdout.mock.calls.map((call) => String(call[0])).join("");
  const flags = { box: "b1", token: "box_test" };

  function boxWith(files: Record<string, unknown>) {
    getBox.mockResolvedValue({ files });
  }

  describe("read", () => {
    it("writes raw content, so a redirect gets the bytes", async () => {
      boxWith({ read: vi.fn().mockResolvedValue("line one\nline two\n") });
      await filesReadCommand("a.txt", { ...flags });
      // No trailing newline of its own, and no JSON envelope.
      expect(out()).toBe("line one\nline two\n");
    });

    it("omits length unless asked, since the server reads it as a ranged read", async () => {
      const read = vi.fn().mockResolvedValue("x");
      boxWith({ read });
      await filesReadCommand("a.txt", { ...flags });
      expect(read).toHaveBeenCalledWith("a.txt", {});
    });

    it("sends offset with length", async () => {
      const read = vi.fn().mockResolvedValue("x");
      boxWith({ read });
      await filesReadCommand("a.txt", { ...flags, offset: "10", length: "20" });
      expect(read).toHaveBeenCalledWith("a.txt", { length: 20, offset: 10 });
    });

    it("defaults the offset to zero when only a length is given", async () => {
      const read = vi.fn().mockResolvedValue("x");
      boxWith({ read });
      await filesReadCommand("a.txt", { ...flags, length: "20" });
      expect(read).toHaveBeenCalledWith("a.txt", { length: 20, offset: 0 });
    });

    it("rejects a non-numeric length rather than sending NaN", async () => {
      boxWith({ read: vi.fn() });
      await expect(filesReadCommand("a.txt", { ...flags, length: "lots" })).rejects.toThrow(
        CliError,
      );
    });

    it("wraps content under --json", async () => {
      boxWith({ read: vi.fn().mockResolvedValue("hi") });
      await filesReadCommand("a.txt", { ...flags, json: true });
      expect(JSON.parse(out())).toEqual({ path: "a.txt", content: "hi" });
    });
  });

  describe("write", () => {
    it("reads content from stdin on -", async () => {
      readFileSync.mockReturnValue("const x = 1;\n");
      const write = vi.fn().mockResolvedValue(undefined);
      boxWith({ write });
      await filesWriteCommand("src/a.ts", "-", { ...flags });
      // Source code does not survive shell quoting, which is why - exists.
      expect(write).toHaveBeenCalledWith({ path: "src/a.ts", content: "const x = 1;\n" });
    });

    it("counts bytes, not JS characters", async () => {
      boxWith({ write: vi.fn().mockResolvedValue(undefined) });
      await filesWriteCommand("a.txt", "é🙂", { ...flags, json: true });
      // 2 bytes + 4 bytes; string length would say 3.
      expect(JSON.parse(out())).toEqual({ path: "a.txt", bytes: 6 });
    });

    it("requires content", async () => {
      boxWith({ write: vi.fn() });
      await expect(filesWriteCommand("a.txt", undefined, { ...flags })).rejects.toThrow(CliError);
    });

    it("reports a failed stdin read as a CLI error", async () => {
      readFileSync.mockImplementation(() => {
        throw new Error("EAGAIN");
      });
      boxWith({ write: vi.fn() });
      await expect(filesWriteCommand("a.txt", "-", { ...flags })).rejects.toThrow(CliError);
    });
  });

  describe("list", () => {
    it("marks directories and shows sizes", async () => {
      boxWith({
        list: vi.fn().mockResolvedValue([
          { name: "src", is_dir: true, size: 4096 },
          { name: "a.txt", is_dir: false, size: 12 },
        ]),
      });
      await filesListCommand(undefined, { ...flags });
      expect(out()).toBe("src/\t4096\na.txt\t12\n");
    });
  });

  describe("the rest", () => {
    it("passes --follow to stat", async () => {
      const stat = vi.fn().mockResolvedValue({ type: "file", size: 1, mod_time: "t", inode: 2 });
      boxWith({ stat });
      await filesStatCommand("a.txt", { ...flags, follow: true });
      expect(stat).toHaveBeenCalledWith("a.txt", { follow: true });
    });

    it("omits the stat options when no flag was given", async () => {
      const stat = vi.fn().mockResolvedValue({ type: "file", size: 1, mod_time: "t", inode: 2 });
      boxWith({ stat });
      await filesStatCommand("a.txt", { ...flags });
      expect(stat).toHaveBeenCalledWith("a.txt", undefined);
    });

    it("passes -p to mkdir", async () => {
      const mkdir = vi.fn().mockResolvedValue(undefined);
      boxWith({ mkdir });
      await filesMkdirCommand("a/b/c", { ...flags, parents: true });
      expect(mkdir).toHaveBeenCalledWith("a/b/c", { parents: true });
    });

    it("only passes -r to remove when it was given", async () => {
      const remove = vi.fn().mockResolvedValue(undefined);
      boxWith({ remove });
      await filesRemoveCommand("build", { ...flags });
      // Without this the server would delete a tree for an imprecise caller.
      expect(remove).toHaveBeenCalledWith("build", undefined);
      await filesRemoveCommand("build", { ...flags, recursive: true });
      expect(remove).toHaveBeenLastCalledWith("build", { recursive: true });
    });

    it("renames", async () => {
      const rename = vi.fn().mockResolvedValue(undefined);
      boxWith({ rename });
      await filesRenameCommand("a.ts", "b.ts", { ...flags });
      expect(rename).toHaveBeenCalledWith("a.ts", "b.ts");
    });
  });
});
