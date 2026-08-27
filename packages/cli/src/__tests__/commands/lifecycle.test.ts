import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Readable } from "node:stream";
import { confirm, deleteCommand, pauseCommand } from "../../commands/lifecycle.js";
import { CliError } from "../../core/errors.js";

const getBox = vi.hoisted(() => vi.fn());
vi.mock("@upstash/box", () => ({ Box: { get: getBox } }));

const boxRef = vi.hoisted(() => ({
  resolveBoxId: vi.fn(),
  announceBox: vi.fn(),
  readOwnBoxFile: vi.fn(),
  clearBoxFile: vi.fn(),
  findBoxFile: vi.fn(),
}));
vi.mock("../../core/box-ref.js", () => boxRef);

describe("box delete", () => {
  let stdout: ReturnType<typeof vi.spyOn>;
  const tty = process.stdin.isTTY;

  beforeEach(() => {
    vi.clearAllMocks();
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    process.env.UPSTASH_BOX_API_KEY = "box_test";
    boxRef.resolveBoxId.mockReturnValue({ id: "box-1", source: "flag" });
    boxRef.readOwnBoxFile.mockReturnValue(undefined);
    boxRef.findBoxFile.mockReturnValue(undefined);
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(process.stdin, "isTTY", { value: tty, configurable: true });
  });

  const out = () => stdout.mock.calls.map((call) => String(call[0])).join("");

  function boxWith() {
    const del = vi.fn().mockResolvedValue(undefined);
    getBox.mockResolvedValue({ delete: del });
    return del;
  }

  it("refuses to delete without confirmation when there is no terminal to ask", async () => {
    const del = boxWith();
    // A script that deletes a box it did not mean to cannot get the work back.
    await expect(deleteCommand(undefined, { token: "box_test" })).rejects.toThrow(CliError);
    expect(del).not.toHaveBeenCalled();
  });

  it("deletes with --yes", async () => {
    const del = boxWith();
    await deleteCommand(undefined, { token: "box_test", yes: true });
    expect(del).toHaveBeenCalled();
    expect(out()).toContain("Deleted box-1");
  });

  it("takes the box id as an argument", async () => {
    boxWith();
    await deleteCommand("box-9", { token: "box_test", yes: true });
    expect(boxRef.resolveBoxId).toHaveBeenCalledWith({ flag: "box-9" });
  });

  it("clears a .box that named the box it just deleted", async () => {
    boxWith();
    boxRef.resolveBoxId.mockReturnValue({ id: "box-1", source: "file", path: "/tmp/.box" });
    boxRef.readOwnBoxFile.mockReturnValue({ path: "/tmp/.box", id: "box-1" });
    boxRef.clearBoxFile.mockReturnValue("/tmp/.box");
    await deleteCommand(undefined, { token: "box_test", yes: true, json: true });
    // Otherwise every later command fails in a way that looks like a broken CLI.
    expect(boxRef.clearBoxFile).toHaveBeenCalled();
    expect(JSON.parse(out())).toMatchObject({ id: "box-1", unpinned: "/tmp/.box" });
  });

  it("clears the pin when the same box was named by id on the command line", async () => {
    boxWith();
    // The scripted shape: ID=$(box create --no-repl); box delete --yes "$ID".
    // The id arrives as a flag, but it is still the pinned box.
    boxRef.resolveBoxId.mockReturnValue({ id: "box-1", source: "flag" });
    boxRef.readOwnBoxFile.mockReturnValue({ path: "/tmp/.box", id: "box-1" });
    boxRef.clearBoxFile.mockReturnValue("/tmp/.box");
    await deleteCommand("box-1", { token: "box_test", yes: true });
    expect(boxRef.clearBoxFile).toHaveBeenCalled();
  });

  it("leaves a .box alone when it names a different box", async () => {
    boxWith();
    boxRef.resolveBoxId.mockReturnValue({ id: "box-1", source: "flag" });
    boxRef.readOwnBoxFile.mockReturnValue({ path: "/tmp/.box", id: "box-other" });
    await deleteCommand("box-1", { token: "box_test", yes: true });
    expect(boxRef.clearBoxFile).not.toHaveBeenCalled();
  });

  it("leaves a parent directory's pin alone but says it is now stale", async () => {
    boxWith();
    boxRef.resolveBoxId.mockReturnValue({ id: "box-1", source: "file", path: "/parent/.box" });
    // Reading the cwd finds nothing; the pin lives one directory up.
    boxRef.readOwnBoxFile.mockImplementation((cwd?: string) =>
      cwd === "/parent" ? { path: "/parent/.box", id: "box-1" } : undefined,
    );
    boxRef.findBoxFile.mockReturnValue("/parent/.box");
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await deleteCommand(undefined, { token: "box_test", yes: true });

    expect(boxRef.clearBoxFile).not.toHaveBeenCalled();
    expect(out()).toContain("Deleted box-1");
    const warned = stderr.mock.calls.map((call) => String(call[0])).join("");
    expect(warned).toContain("/parent/.box still points at it");
  });

  it("says nothing about a parent pin that names a different box", async () => {
    boxWith();
    boxRef.resolveBoxId.mockReturnValue({ id: "box-1", source: "flag" });
    boxRef.readOwnBoxFile.mockImplementation((cwd?: string) =>
      cwd === "/parent" ? { path: "/parent/.box", id: "box-other" } : undefined,
    );
    boxRef.findBoxFile.mockReturnValue("/parent/.box");
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    await deleteCommand("box-1", { token: "box_test", yes: true });

    const warned = stderr.mock.calls.map((call) => String(call[0])).join("");
    expect(warned).not.toContain("still points at it");
  });

  it("still reports the delete when the pin could not be cleared", async () => {
    boxWith();
    boxRef.resolveBoxId.mockReturnValue({ id: "box-1", source: "file", path: "/tmp/.box" });
    boxRef.readOwnBoxFile.mockReturnValue({ path: "/tmp/.box", id: "box-1" });
    boxRef.clearBoxFile.mockImplementation(() => {
      throw new CliError("could not remove it");
    });
    await deleteCommand(undefined, { token: "box_test", yes: true });
    expect(out()).toContain("Deleted box-1");
  });
});

describe("box pause", () => {
  let stdout: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    process.env.UPSTASH_BOX_API_KEY = "box_test";
    boxRef.resolveBoxId.mockReturnValue({ id: "box-1", source: "flag" });
  });
  afterEach(() => vi.restoreAllMocks());

  it("pauses without asking, since nothing is lost", async () => {
    const pause = vi.fn().mockResolvedValue(undefined);
    getBox.mockResolvedValue({ pause });
    await pauseCommand(undefined, { token: "box_test" });
    expect(pause).toHaveBeenCalled();
    const text = stdout.mock.calls.map((call) => String(call[0])).join("");
    expect(text).toContain("Paused box-1");
  });
});

describe("confirm", () => {
  const real = process.stdin;

  function feed(text: string) {
    Object.defineProperty(process, "stdin", {
      value: Readable.from([text]),
      configurable: true,
    });
  }
  afterEach(() => {
    Object.defineProperty(process, "stdin", { value: real, configurable: true });
  });

  it("accepts y and yes", async () => {
    feed("y\n");
    expect(await confirm("? ")).toBe(true);
    feed("YES\n");
    expect(await confirm("? ")).toBe(true);
  });

  it("treats anything else as no", async () => {
    feed("n\n");
    expect(await confirm("? ")).toBe(false);
    feed("maybe\n");
    expect(await confirm("? ")).toBe(false);
  });

  it("settles on end of input rather than hanging", async () => {
    // Without this the prompt never resolves and the command exits having
    // silently done nothing, which for a delete reads as success.
    feed("");
    expect(await confirm("? ")).toBe(false);
  });
});
