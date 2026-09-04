import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execCodeCommand } from "../../commands/exec.js";
import { browserExtractCommand } from "../../commands/browser.js";
import { CliError } from "../../core/errors.js";

const getBox = vi.hoisted(() => vi.fn());
vi.mock("@upstash/box", () => ({ Box: { get: getBox } }));

vi.mock("../../core/box-ref.js", () => ({
  resolveBoxId: vi.fn(() => ({ id: "b1", source: "flag" })),
  announceBox: vi.fn(),
}));

describe("box code", () => {
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;
  const flags = { box: "b1", token: "box_test" };
  const written = () => stdout.mock.calls.map((c) => String(c[0])).join("");

  /** A box whose exec.code resolves to a Run-shaped result. */
  const codeReturns = (run: Record<string, unknown>) => {
    const code = vi.fn().mockResolvedValue(run);
    getBox.mockResolvedValue({ exec: { code } });
    return code;
  };

  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    getBox.mockReset();
    process.exitCode = undefined;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  it("converts the timeout from seconds to milliseconds", async () => {
    // --timeout 30 against a milliseconds option would kill the code in 30ms.
    const code = codeReturns({ stdout: "", stderr: "", exitCode: 0 });

    await execCodeCommand("print(1)", { ...flags, timeout: "30" });

    expect(code).toHaveBeenCalledWith(expect.objectContaining({ timeout: 30_000 }));
  });

  it("passes a failing snippet's exit code through", async () => {
    // Reporting 0 would make `box code ... && next` run the next thing.
    codeReturns({ stdout: "", stderr: "Traceback", exitCode: 1 });

    await execCodeCommand("raise SystemExit(1)", { ...flags });

    expect(process.exitCode).toBe(1);
  });

  it("leaves the exit code alone on success", async () => {
    codeReturns({ stdout: "2\n", stderr: "", exitCode: 0 });

    await execCodeCommand("print(1+1)", { ...flags });

    expect(process.exitCode).toBeUndefined();
    expect(written()).toContain("2");
  });

  it("reports the real exit code under --json", async () => {
    codeReturns({ stdout: "out", stderr: "err", exitCode: 3 });

    await execCodeCommand("x", { ...flags, json: true });

    expect(JSON.parse(written())).toEqual({ stdout: "out", stderr: "err", exit_code: 3 });
    expect(process.exitCode).toBe(3);
  });

  it("sends stderr to stderr, so stdout stays pipeable", async () => {
    codeReturns({ stdout: "data", stderr: "warning", exitCode: 0 });

    await execCodeCommand("x", { ...flags });

    expect(written()).toContain("data");
    expect(written()).not.toContain("warning");
    expect(stderr.mock.calls.map((c) => String(c[0])).join("")).toContain("warning");
  });

  it("rejects an unknown language rather than guessing", async () => {
    codeReturns({ stdout: "", stderr: "", exitCode: 0 });

    await expect(execCodeCommand("x", { ...flags, lang: "ruby" })).rejects.toThrow(/--lang/);
  });

  it("rejects a timeout that is not a positive number of seconds", async () => {
    codeReturns({ stdout: "", stderr: "", exitCode: 0 });

    await expect(execCodeCommand("x", { ...flags, timeout: "nope" })).rejects.toThrow(CliError);
  });
});

describe("browser extract schema", () => {
  let dir: string;
  const flags = { box: "b1", token: "box_test" };

  beforeEach(() => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    dir = mkdtempSync(join(tmpdir(), "box-schema-"));
    getBox.mockReset();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  const schemaAt = (body: unknown) => {
    const path = join(dir, "schema.json");
    writeFileSync(path, JSON.stringify(body));
    return path;
  };

  const tabReturning = (result: unknown) => {
    const extract = vi.fn().mockResolvedValue(result);
    getBox.mockResolvedValue({
      browser: { listTabs: vi.fn().mockResolvedValue([{ id: "t", extract }]) },
    });
    return extract;
  };

  it("converts a flat schema and extracts against it", async () => {
    const extract = tabReturning({ title: "Hi", count: 2 });
    const schema = schemaAt({
      type: "object",
      properties: {
        title: { type: "string" },
        count: { type: "number" },
        ok: { type: "boolean" },
        tags: { type: "array", items: { type: "string" } },
      },
    });

    await browserExtractCommand("read the page", { ...flags, schema });

    expect(extract).toHaveBeenCalledWith("read the page", expect.anything());
  });

  it("refuses a nested object rather than dropping the field", async () => {
    // A dropped field comes back as a missing key, which reads as "the page did
    // not have it" rather than as a schema the CLI could not express.
    tabReturning({});
    const schema = schemaAt({
      type: "object",
      properties: { author: { type: "object" } },
    });

    await expect(browserExtractCommand("x", { ...flags, schema })).rejects.toThrow(
      /unsupported type object/,
    );
  });

  it("refuses an array of non-strings", async () => {
    tabReturning({});
    const schema = schemaAt({
      type: "object",
      properties: { rows: { type: "array", items: { type: "number" } } },
    });

    await expect(browserExtractCommand("x", { ...flags, schema })).rejects.toThrow(
      /arrays of string/,
    );
  });

  it("refuses a schema that is not an object", async () => {
    tabReturning({});
    const schema = schemaAt({ type: "string" });

    await expect(browserExtractCommand("x", { ...flags, schema })).rejects.toThrow(/type.*object/);
  });

  it("refuses a schema file holding null with a message, not a TypeError", async () => {
    // JSON.parse("null") succeeds, so the property read below it threw a raw
    // TypeError past the CLI's own validation.
    tabReturning({});
    const schema = schemaAt(null);

    await expect(browserExtractCommand("x", { ...flags, schema })).rejects.toThrow(/type.*object/);
  });

  it("names the file when it cannot be read", async () => {
    tabReturning({});

    await expect(
      browserExtractCommand("x", { ...flags, schema: join(dir, "missing.json") }),
    ).rejects.toThrow(/Could not read the schema/);
  });
});
