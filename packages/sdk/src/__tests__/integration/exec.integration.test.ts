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
    expect(run.status).toBe("completed");
    expect(run.exitCode).toBe(0);
  });

  it("exec.code: runs inline JavaScript", async () => {
    const run = await box.exec.code({
      code: "console.log(JSON.stringify({ sum: 1 + 2 }))",
      lang: "js",
    });
    expect(run.exitCode).toBe(0);
    expect(run.result).toContain('"sum":3');
    expect(run.type).toBe("code");
  });

  it("exec.stream: streams multi-line shell output", async () => {
    const run = await box.exec.stream("ping -c 5 127.0.0.1");
    const chunks: string[] = [];
    for await (const chunk of run) {
      if (chunk.type === "output") {
        chunks.push(chunk.data);
      }
    }

    const fullOutput = chunks.join("");

    expect(fullOutput).toContain("PING 127.0.0.1");
    for (let i = 0; i < 5; i++) {
      expect(fullOutput).toContain(`seq=${i}`);
    }
    expect(fullOutput).toContain("packets transmitted");

    // Must have received multiple output chunks (not all in one batch)
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    // Run should be populated after iteration
    expect(run.status).toBe("completed");
    expect(run.exitCode).toBe(0);
    expect(run.result).toContain("PING 127.0.0.1");
  }, 30000);

  it("exec.streamCode: streams multi-line JS output", async () => {
    const code = `
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  for (let i = 0; i < 5; i++) {
    console.log("Step " + i);
    await sleep(1000);
  }
})();
`.trim();
    const run = await box.exec.streamCode({ code, lang: "js" });
    const chunks: string[] = [];
    for await (const chunk of run) {
      if (chunk.type === "output") {
        chunks.push(chunk.data);
      }
    }

    const fullOutput = chunks.join("");

    for (let i = 0; i < 5; i++) {
      expect(fullOutput).toContain(`Step ${i}`);
    }

    // Must have received multiple output chunks (not all in one batch)
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    // Run should be populated after iteration
    expect(run.status).toBe("completed");
    expect(run.exitCode).toBe(0);
    expect(run.type).toBe("code");
  }, 30000);
});
