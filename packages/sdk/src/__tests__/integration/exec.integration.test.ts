import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Box, ClaudeCode } from "../../index.js";
import type { ExecStreamChunk } from "../../index.js";
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

  it("exec.stream: streams multi-line shell output", async () => {
    const chunks: ExecStreamChunk[] = [];
    for await (const chunk of box.exec.stream("ping -c 5 127.0.0.1")) {
      chunks.push(chunk);
    }

    // Chunk boundaries are non-deterministic (the server may batch
    // multiple lines into one chunk), so verify content, not boundaries.
    const outputChunks = chunks.filter((c) => c.type === "output");
    const fullOutput = outputChunks.map((c) => (c.type === "output" ? c.data : "")).join("");

    expect(fullOutput).toContain("PING 127.0.0.1");
    for (let i = 0; i < 5; i++) {
      expect(fullOutput).toContain(`seq=${i}`);
    }
    expect(fullOutput).toContain("packets transmitted");

    // Must have received multiple output chunks (not all in one batch)
    expect(outputChunks.length).toBeGreaterThanOrEqual(2);

    // Last chunk is always the exit event
    expect(chunks[chunks.length - 1]).toEqual({
      type: "exit",
      exitCode: 0,
      cpuNs: expect.any(Number),
    });
  }, 30000);

  it("exec.streamCode: streams multi-line JS output", async () => {
    const chunks: ExecStreamChunk[] = [];
    const code = `
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 5; i++) {
    console.log("Step " + i);
    await sleep(1000);
  }
})();
`.trim();
    for await (const chunk of box.exec.streamCode({ code, lang: "js" })) {
      chunks.push(chunk);
    }

    const outputChunks = chunks.filter((c) => c.type === "output");
    const fullOutput = outputChunks.map((c) => (c.type === "output" ? c.data : "")).join("");

    for (let i = 0; i < 5; i++) {
      expect(fullOutput).toContain(`Step ${i}`);
    }

    // Must have received multiple output chunks (not all in one batch)
    expect(outputChunks.length).toBeGreaterThanOrEqual(2);

    // Last chunk is always the exit event
    expect(chunks[chunks.length - 1]).toEqual({
      type: "exit",
      exitCode: 0,
      cpuNs: expect.any(Number),
    });
  }, 30000);
});
