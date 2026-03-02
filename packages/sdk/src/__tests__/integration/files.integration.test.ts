import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Box, ClaudeCode } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";

describe.skipIf(!UPSTASH_BOX_API_KEY)("files", () => {
  let box: Box;
  let tmpDir: string;

  beforeAll(async () => {
    box = await Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: { model: ClaudeCode.Opus_4_6 },
    });
    tmpDir = join(tmpdir(), `box-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
  }, 120000);

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("files: write then read roundtrip", async () => {
    await box.files.write({ path: "test-file.txt", content: "integration test content" });
    const content = await box.files.read("test-file.txt");
    expect(content).toBe("integration test content");
  });

  it("files: list shows written file", async () => {
    const files = await box.files.list();
    const found = files.some((f) => f.name === "test-file.txt");
    expect(found).toBe(true);
  });

  it("files: upload sends a local file to the box", async () => {
    const localPath = join(tmpDir, "upload-test.txt");
    writeFileSync(localPath, "uploaded content");

    await box.files.upload([{ path: localPath, destination: "uploaded.txt" }]);

    const content = await box.files.read("uploaded.txt");
    expect(content).toBe("uploaded content");
  });

  it("files: download retrieves files from the box", async () => {
    // Write a file inside a subdirectory on the box
    await box.exec.command("mkdir -p dl-test");
    await box.files.write({ path: "dl-test/hello.txt", content: "download content" });

    // Change cwd to tmpDir so download lands there
    const origCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      await box.files.download({ path: "dl-test" });
    } finally {
      process.chdir(origCwd);
    }

    const downloaded = join(tmpDir, "dl-test", "hello.txt");
    expect(existsSync(downloaded)).toBe(true);
    expect(readFileSync(downloaded, "utf-8")).toBe("download content");
  });
});
