import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  announceBox,
  boxBanner,
  clearBoxFile,
  findBoxFile,
  resolveBoxId,
  writeBoxFile,
  readOwnBoxFile,
} from "../../core/box-ref.js";
import { CLI_FAILURE_EXIT_CODE, CliError } from "../../core/errors.js";

describe("box resolution", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "box-ref-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("prefers the flag over everything else", () => {
    writeFileSync(path.join(root, ".box"), "from-file\n");
    const resolved = resolveBoxId({
      flag: "from-flag",
      env: { BOX_ID: "from-env" },
      cwd: root,
    });
    expect(resolved).toMatchObject({ id: "from-flag", source: "flag" });
  });

  it("prefers BOX_ID over a .box file", () => {
    // The CI case: a checked-out .box from someone else's machine must not win
    // over the id the job was handed.
    writeFileSync(path.join(root, ".box"), "from-file\n");
    const resolved = resolveBoxId({ env: { BOX_ID: "from-env" }, cwd: root });
    expect(resolved).toMatchObject({ id: "from-env", source: "env" });
  });

  it("falls back to the .box file", () => {
    writeFileSync(path.join(root, ".box"), "from-file\n");
    const resolved = resolveBoxId({ env: {}, cwd: root });
    expect(resolved).toMatchObject({ id: "from-file", source: "file" });
    expect(resolved.path).toBe(path.join(root, ".box"));
  });

  it("walks up to find .box, like git does", () => {
    // Working in src/ is the normal thing to do; a cwd-only lookup would fail.
    writeFileSync(path.join(root, ".box"), "parent-box\n");
    const nested = path.join(root, "src", "deep");
    mkdirSync(nested, { recursive: true });
    const resolved = resolveBoxId({ env: {}, cwd: nested });
    expect(resolved.id).toBe("parent-box");
    expect(resolved.path).toBe(path.join(root, ".box"));
  });

  it("ignores an empty or whitespace-only source", () => {
    writeFileSync(path.join(root, ".box"), "   \n");
    expect(() => resolveBoxId({ env: {}, cwd: root })).toThrow(CliError);
    expect(() => resolveBoxId({ flag: "   ", env: { BOX_ID: "  " }, cwd: root })).toThrow(CliError);
  });

  it("fails with an actionable message and the CLI failure code", () => {
    try {
      resolveBoxId({ env: {}, cwd: root });
      throw new Error("expected a rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(CliError);
      expect((error as CliError).exitCode).toBe(CLI_FAILURE_EXIT_CODE);
      expect((error as CliError).message).toContain("--box");
      expect((error as CliError).message).toContain("BOX_ID");
      expect((error as CliError).message).toContain("box use");
    }
  });

  it("returns undefined when no .box exists anywhere above", () => {
    expect(findBoxFile(root)).toBeUndefined();
  });

  describe("banner", () => {
    it("names the absolute path a file source came from", () => {
      // Without the path you cannot tell you inherited a parent directory's box.
      writeFileSync(path.join(root, ".box"), "abc123\n");
      const nested = path.join(root, "src");
      mkdirSync(nested, { recursive: true });
      const banner = boxBanner(resolveBoxId({ env: {}, cwd: nested }));
      expect(banner).toBe(`box: abc123 (from ${path.join(root, ".box")})`);
    });

    it("names the flag and the environment variable", () => {
      expect(boxBanner({ id: "a", source: "flag" })).toBe("box: a (from --box)");
      expect(boxBanner({ id: "b", source: "env" })).toBe("box: b (from BOX_ID)");
    });
  });

  describe("readOwnBoxFile", () => {
    it("reads this directory's own pin", () => {
      writeFileSync(path.join(root, ".box"), "pinned-box\n");
      expect(readOwnBoxFile(root)).toEqual({ path: path.join(root, ".box"), id: "pinned-box" });
    });

    it("does not walk up to a parent's pin", () => {
      // `box delete` uses this to decide whether to clear the pin, and clearing
      // a parent's would take the whole project's with it.
      writeFileSync(path.join(root, ".box"), "parent-box\n");
      const nested = path.join(root, "src");
      mkdirSync(nested);
      expect(readOwnBoxFile(nested)).toBeUndefined();
    });

    it("treats an empty file as no pin", () => {
      writeFileSync(path.join(root, ".box"), "   \n");
      expect(readOwnBoxFile(root)).toBeUndefined();
    });

    it("returns undefined when there is no file", () => {
      expect(readOwnBoxFile(root)).toBeUndefined();
    });
  });

  describe("write and clear", () => {
    it("writes a .box that resolves back", () => {
      const written = writeBoxFile("written-box", root);
      expect(existsSync(written)).toBe(true);
      expect(resolveBoxId({ env: {}, cwd: root }).id).toBe("written-box");
    });

    it("clears this directory's own .box", () => {
      writeBoxFile("written-box", root);
      const removed = clearBoxFile(root);
      expect(removed).toBe(path.join(root, ".box"));
      expect(existsSync(path.join(root, ".box"))).toBe(false);
    });

    it("refuses to unset a parent's .box from a subdirectory", () => {
      // Walking up here would let an agent working in src/ delete the whole
      // project's pin — the same silent-wrong-directory failure in reverse.
      writeBoxFile("parent-box", root);
      const nested = path.join(root, "src");
      mkdirSync(nested, { recursive: true });

      expect(() => clearBoxFile(nested)).toThrow(CliError);
      expect(existsSync(path.join(root, ".box"))).toBe(true);
    });

    it("names the nearest file when there is nothing to unset here", () => {
      writeBoxFile("parent-box", root);
      const nested = path.join(root, "src");
      mkdirSync(nested, { recursive: true });
      expect(() => clearBoxFile(nested)).toThrow(new RegExp(path.join(root, ".box")));
    });
  });

  describe("empty .box files", () => {
    it("keeps walking past an empty file to a valid parent", () => {
      // Stopping at the empty file would hide the pin one level up.
      writeFileSync(path.join(root, ".box"), "parent-box\n");
      const nested = path.join(root, "src");
      mkdirSync(nested, { recursive: true });
      writeFileSync(path.join(nested, ".box"), "   \n");

      const resolved = resolveBoxId({ env: {}, cwd: nested });
      expect(resolved.id).toBe("parent-box");
      expect(resolved.path).toBe(path.join(root, ".box"));
    });

    it("names the empty file when nothing else resolves", () => {
      writeFileSync(path.join(root, ".box"), "\n");
      expect(() => resolveBoxId({ env: {}, cwd: root })).toThrow(/empty \.box at/);
    });
  });

  describe("announceBox", () => {
    it("warns whenever BOX_ID shadows a file, not only in status", () => {
      writeFileSync(path.join(root, ".box"), "file-box\n");
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      announceBox({ id: "env-box", source: "env" }, root);
      const written = stderr.mock.calls.map((call) => String(call[0])).join("");
      expect(written).toContain("box: env-box (from BOX_ID)");
      expect(written).toContain(`takes precedence over ${path.join(root, ".box")}`);
      stderr.mockRestore();
    });

    it("says nothing extra when no file is shadowed", () => {
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      announceBox({ id: "flag-box", source: "flag" }, root);
      expect(stderr.mock.calls).toHaveLength(1);
      stderr.mockRestore();
    });
  });
});
