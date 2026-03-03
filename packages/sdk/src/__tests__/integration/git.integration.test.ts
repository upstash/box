import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Box, ClaudeCode } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";

describe.skipIf(!UPSTASH_BOX_API_KEY)("git", () => {
  let box: Box;

  beforeAll(async () => {
    box = await Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: { model: ClaudeCode.Opus_4_6 },
    });

    // Initialize a git repo so git commands work
    await box.exec.command("cd /workspace/home && git init && git checkout -b main");
    await box.exec.command(
      'cd /workspace/home && git config user.email "test@test.com" && git config user.name "Test"',
    );
    await box.files.write({ path: "hello.txt", content: "hello" });
    await box.exec.command("cd /workspace/home && git add . && git commit -m 'initial commit'");
  }, 120000);

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("git.status: returns status", async () => {
    const status = await box.git.status();
    expect(typeof status).toBe("string");
  });

  it("git.exec: runs an arbitrary git command", async () => {
    const result = await box.git.exec({ args: ["log", "--oneline", "-1"] });
    expect(result.output).toContain("initial commit");
  });

  it("git.checkout: switches branches", async () => {
    // Create and switch to a new branch
    await box.git.exec({ args: ["branch", "test-branch"] });
    await box.git.checkout({ branch: "test-branch" });

    // Verify we're on the new branch
    const result = await box.git.exec({ args: ["branch", "--show-current"] });
    expect(result.output.trim()).toBe("test-branch");

    // Switch back
    await box.git.checkout({ branch: "main" });
    const result2 = await box.git.exec({ args: ["branch", "--show-current"] });
    expect(result2.output.trim()).toBe("main");
  });

  it("git.diff: returns diff after changes", async () => {
    await box.files.write({ path: "hello.txt", content: "hello world" });
    const diff = await box.git.diff();
    expect(diff).toContain("hello world");
  });

  it("git.commit: commits staged changes", async () => {
    await box.exec.command("cd /workspace/home && git add .");
    const result = await box.git.commit({ message: "update hello" });
    expect(result.sha).toBeTruthy();
    expect(result.message).toContain("update hello");
  });
});
