import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Agent, Box, ClaudeCode } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";

describe.skipIf(!UPSTASH_BOX_API_KEY)("schedule", () => {
  let box: Box;

  beforeAll(async () => {
    box = await Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: { provider: Agent.ClaudeCode, model: ClaudeCode.Opus_4_6 },
    });
  }, 120000);

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("schedule.exec: creates and verifies all fields via list", async () => {
    const schedule = await box.schedule.exec({
      cron: "*/5 * * * *",
      command: ["bash", "-c", "echo hello"],
      webhookUrl: "https://example.com/webhook",
      webhookHeaders: { Authorization: "Bearer token" },
    });

    expect(schedule.id).toBeDefined();
    expect(schedule.type).toBe("exec");
    expect(schedule.status).toBe("active");
    expect(schedule.folder).toBe("/workspace/home");
    expect(schedule.command).toEqual(["bash", "-c", "echo hello"]);
    expect(schedule.webhook_url).toBe("https://example.com/webhook");
    expect(schedule.webhook_headers).toEqual({ Authorization: "Bearer token" });

    const list = await box.schedule.list();
    const found = list.find((s) => s.id === schedule.id)!;
    expect(found).toBeDefined();
    expect(found).toEqual(schedule);

    await box.schedule.delete(schedule.id);
  }, 30000);

  it("schedule.agent: creates and verifies all fields via list", async () => {
    const schedule = await box.schedule.agent({
      cron: "0 9 * * *",
      prompt: "Run the test suite",
      model: "anthropic/claude-sonnet-4-6",
      webhookUrl: "https://example.com/hook",
      webhookHeaders: { "x-key": "val" },
    });

    expect(schedule.id).toBeDefined();
    expect(schedule.type).toBe("prompt");
    expect(schedule.status).toBe("active");
    expect(schedule.prompt).toBe("Run the test suite");
    expect(schedule.model).toBe("anthropic/claude-sonnet-4-6");

    const list = await box.schedule.list();
    const found = list.find((s) => s.id === schedule.id)!;
    expect(found).toBeDefined();
    expect(found).toEqual(schedule);

    await box.schedule.delete(schedule.id);
  }, 30000);

  it("schedule.exec: pause, resume, and delete lifecycle", async () => {
    const schedule = await box.schedule.exec({
      cron: "* * * * *",
      command: ["echo", "lifecycle"],
    });

    expect(schedule.status).toBe("active");

    await box.schedule.pause(schedule.id);
    const paused = await box.schedule.get(schedule.id);
    expect(paused.status).toBe("paused");

    await box.schedule.resume(schedule.id);
    const resumed = await box.schedule.get(schedule.id);
    expect(resumed.status).toBe("active");

    await box.schedule.delete(schedule.id);

    const list = await box.schedule.list();
    expect(list.some((s) => s.id === schedule.id)).toBe(false);
  }, 30000);

  it("schedule uses box.cwd as default folder", async () => {
    await box.exec.command("mkdir -p /workspace/home/subdir");
    await box.cd("subdir");

    const schedule = await box.schedule.exec({
      cron: "0 0 * * *",
      command: ["pwd"],
    });

    expect(schedule.folder).toBe("/workspace/home/subdir");

    const list = await box.schedule.list();
    const found = list.find((s) => s.id === schedule.id)!;
    expect(found).toEqual(schedule);

    await box.schedule.delete(schedule.id);
    await box.cd("/workspace/home");
  }, 30000);

  it("schedule resolves relative folder against box.cwd", async () => {
    await box.exec.command("mkdir -p /workspace/home/parent/child");
    await box.cd("parent");

    const schedule = await box.schedule.agent({
      cron: "0 0 * * *",
      prompt: "test relative folder",
      folder: "child",
    });

    expect(schedule.folder).toBe("/workspace/home/parent/child");

    const list = await box.schedule.list();
    const found = list.find((s) => s.id === schedule.id)!;
    expect(found).toEqual(schedule);

    await box.schedule.delete(schedule.id);
    await box.cd("/workspace/home");
  }, 30000);
});
