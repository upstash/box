import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Box, ClaudeCode, Agent } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";

describe.skipIf(!UPSTASH_BOX_API_KEY)("env vars", () => {
  let box: Box;

  beforeAll(async () => {
    box = await Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: { runner: Agent.ClaudeCode, model: ClaudeCode.Sonnet_4_6 },
      env: {
        MY_SECRET: "super-secret-value",
        APP_MODE: "production",
        EMPTY_VAR: "",
      },
    });
  }, 120000);

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("env vars are available in shell commands", async () => {
    const run = await box.exec.command("echo $MY_SECRET");
    expect(run.exitCode).toBe(0);
    expect(run.result).toContain("super-secret-value");
  });

  it("multiple env vars are set", async () => {
    const run = await box.exec.command("echo $APP_MODE");
    expect(run.exitCode).toBe(0);
    expect(run.result).toContain("production");
  });

  it("env vars are available in inline code", async () => {
    const run = await box.exec.code({
      code: "console.log(process.env.MY_SECRET)",
      lang: "js",
    });
    expect(run.exitCode).toBe(0);
    expect(run.result).toContain("super-secret-value");
  });
});
