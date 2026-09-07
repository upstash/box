import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runCommandAction } from "../../commands/run.js";
import { CliError } from "../../core/errors.js";

const getBox = vi.hoisted(() => vi.fn());
vi.mock("@upstash/box", () => ({ Box: { get: getBox } }));

const readFileSync = vi.hoisted(() => vi.fn());
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  readFileSync,
}));

describe("box run", () => {
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    process.env.UPSTASH_BOX_API_KEY = "box_test";
    getBox.mockReset();
    readFileSync.mockReset();
  });
  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
  });

  const out = () => stdout.mock.calls.map((call) => String(call[0])).join("");
  const err = () => stderr.mock.calls.map((call) => String(call[0])).join("");

  function boxStreaming(chunks: unknown[]) {
    const stream = vi.fn().mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) yield chunk;
      },
    });
    getBox.mockResolvedValue({ agent: { stream } });
    return stream;
  }

  const flags = { box: "b1", token: "box_test" };

  it("streams the agent's text to stdout as it arrives", async () => {
    boxStreaming([
      { type: "text-delta", text: "one " },
      { type: "text-delta", text: "two" },
      { type: "finish", output: "one two", sessionId: "s1", usage: { outputTokens: 2 } },
    ]);
    await runCommandAction(["do", "a", "thing"], { ...flags });
    expect(out()).toBe("one two\n");
  });

  it("keeps the tool log on stderr so stdout stays pipeable", async () => {
    boxStreaming([
      { type: "tool-call", toolName: "Read", input: { file_path: "/workspace/home/a.ts" } },
      { type: "text-delta", text: "answer" },
      { type: "finish", output: "answer", sessionId: "s", usage: {} },
    ]);
    await runCommandAction(["read", "it"], { ...flags });
    expect(out()).toBe("answer\n");
    expect(err()).toContain("Read: /workspace/home/a.ts");
  });

  it("suppresses the tool log under --quiet", async () => {
    boxStreaming([
      { type: "tool-call", toolName: "Bash", input: { command: "ls" } },
      { type: "text-delta", text: "answer" },
      { type: "finish", output: "answer", sessionId: "s", usage: {} },
    ]);
    await runCommandAction(["go"], { ...flags, quiet: true });
    expect(err()).not.toContain("Bash");
  });

  it("prints one object under --json, with the session id and usage", async () => {
    boxStreaming([
      { type: "text-delta", text: "partial" },
      { type: "finish", output: "final", sessionId: "s2", usage: { outputTokens: 7 } },
    ]);
    await runCommandAction(["go"], { ...flags, json: true });
    const parsed = JSON.parse(out());
    // The finish chunk is authoritative: the deltas can be a prefix of it.
    expect(parsed).toEqual({ output: "final", session_id: "s2", usage: { outputTokens: 7 } });
  });

  it("does not stream to stdout under --json", async () => {
    boxStreaming([
      { type: "text-delta", text: "partial" },
      { type: "finish", output: "partial", sessionId: null, usage: null },
    ]);
    await runCommandAction(["go"], { ...flags, json: true });
    expect(JSON.parse(out())).toEqual({ output: "partial", session_id: null, usage: null });
  });

  it("reads the prompt from stdin on -", async () => {
    readFileSync.mockReturnValue("a prompt too long to quote\n");
    const stream = boxStreaming([
      { type: "text-delta", text: "ok" },
      { type: "finish", output: "ok", sessionId: "s", usage: {} },
    ]);
    await runCommandAction(["-"], { ...flags });
    expect(stream).toHaveBeenCalledWith({ prompt: "a prompt too long to quote" });
  });

  it("sends the timeout in milliseconds", async () => {
    const stream = boxStreaming([
      { type: "text-delta", text: "ok" },
      { type: "finish", output: "ok", sessionId: "s", usage: {} },
    ]);
    await runCommandAction(["go"], { ...flags, timeout: "30" });
    expect(stream).toHaveBeenCalledWith({ prompt: "go", timeout: 30_000 });
  });

  it("omits the timeout when it was not given", async () => {
    const stream = boxStreaming([
      { type: "text-delta", text: "ok" },
      { type: "finish", output: "ok", sessionId: "s", usage: {} },
    ]);
    await runCommandAction(["go"], { ...flags });
    expect(stream).toHaveBeenCalledWith({ prompt: "go" });
  });

  it("rejects a timeout outside Node's timer range", async () => {
    // The SDK arms this with setTimeout, and Node clamps an overflowing delay
    // to about a millisecond, so the run would abort almost immediately.
    boxStreaming([]);
    await expect(runCommandAction(["go"], { ...flags, timeout: "Infinity" })).rejects.toThrow(
      CliError,
    );
    await expect(runCommandAction(["go"], { ...flags, timeout: "999999999" })).rejects.toThrow(
      /at most/,
    );
  });

  it("rejects a non-numeric timeout instead of sending NaN", async () => {
    boxStreaming([]);
    await expect(runCommandAction(["go"], { ...flags, timeout: "soon" })).rejects.toThrow(CliError);
  });

  it("refuses a stream that never reported finishing", async () => {
    // The iterator can end at EOF without the run completing, and a partial
    // answer consumed as a whole one is worse than a failure.
    boxStreaming([{ type: "text-delta", text: "half an ans" }]);
    await expect(runCommandAction(["go"], { ...flags })).rejects.toThrow(CliError);
  });

  it("trusts an empty finish output over the deltas", async () => {
    // Guarding on truthiness kept the partial deltas when the authoritative
    // answer was the empty string.
    boxStreaming([
      { type: "text-delta", text: "scratch" },
      { type: "finish", output: "", sessionId: "s", usage: {} },
    ]);
    await runCommandAction(["go"], { ...flags, json: true });
    expect(JSON.parse(out()).output).toBe("");
  });

  it("rejects an empty prompt", async () => {
    boxStreaming([]);
    await expect(runCommandAction([], { ...flags })).rejects.toThrow(CliError);
  });
});
