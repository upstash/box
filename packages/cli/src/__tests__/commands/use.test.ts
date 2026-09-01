import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { useCommand } from "../../commands/use.js";
import { CliError } from "../../core/errors.js";

/**
 * Argv-level coverage: these assert what a caller actually receives on stdout
 * for a given set of flags, which is the layer a wrong flag-merge would break
 * without any unit test noticing.
 */
describe("box use", () => {
  let root: string;
  let cwd: string;
  let stdout: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), "box-use-")));
    cwd = process.cwd();
    process.chdir(root);
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  });
  afterEach(() => {
    stdout.mockRestore();
    process.chdir(cwd);
    rmSync(root, { recursive: true, force: true });
  });

  const written = () => stdout.mock.calls.map((call) => String(call[0])).join("");

  it("writes .box and reports the path", async () => {
    await useCommand("abc123", {});
    expect(readFileSync(path.join(root, ".box"), "utf8").trim()).toBe("abc123");
    expect(written()).toContain("Using abc123");
  });

  it("emits raw JSON under --json, with no envelope", async () => {
    await useCommand("abc123", { json: true });
    const parsed = JSON.parse(written());
    expect(parsed.id).toBe("abc123");
    expect(parsed.path).toBe(path.join(root, ".box"));
    expect(parsed).not.toHaveProperty("ok");
  });

  it("tells the reader not to commit the file", async () => {
    await useCommand("abc123", {});
    expect(written()).toContain(".gitignore");
  });

  it("unsets this directory's file", async () => {
    writeFileSync(path.join(root, ".box"), "abc123\n");
    await useCommand(undefined, { unset: true });
    expect(existsSync(path.join(root, ".box"))).toBe(false);
  });

  it("refuses to unset a parent's file from a subdirectory", async () => {
    // The whole point of the fix: an agent in src/ must not remove the
    // project's pin.
    writeFileSync(path.join(root, ".box"), "abc123\n");
    const nested = path.join(root, "src");
    mkdirSync(nested);
    process.chdir(nested);

    await expect(useCommand(undefined, { unset: true })).rejects.toThrow(CliError);
    expect(existsSync(path.join(root, ".box"))).toBe(true);
  });

  it("requires an id when not unsetting", async () => {
    await expect(useCommand(undefined, {})).rejects.toThrow(/Usage: box use/);
    await expect(useCommand("   ", {})).rejects.toThrow(/Usage: box use/);
  });
});
