import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Box, ClaudeCode } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";

describe.skipIf(!UPSTASH_BOX_API_KEY)("exec", () => {
  let box: Box;

  beforeAll(async () => {
    box = await Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: { model: ClaudeCode.Opus_4_6 },
    });
  }, 120000);

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("exec.command: runs a shell command", async () => {
    const run = await box.exec.command("echo hello");
    expect(run.result).toContain("hello");
    expect(run._status).toBe("completed");
  });

  it("exec.code: runs inline JavaScript", async () => {
    const result = await box.exec.code({
      code: "console.log(JSON.stringify({ sum: 1 + 2 }))",
      lang: "js",
    });
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain('"sum":3');
  });
});
