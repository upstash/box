import { describe, it, expect, afterAll } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EphemeralBox } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";

describe.skipIf(!UPSTASH_BOX_API_KEY)("EphemeralBox — node runtime", () => {
  let box: EphemeralBox;
  let tmpDir: string;

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
    try {
      if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("creates an ephemeral box with node runtime", async () => {
    box = await EphemeralBox.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      runtime: "node",
      ttl: 300,
    });

    expect(box.id).toBeTruthy();
    expect(box.expiresAt).toBeGreaterThan(0);
  }, 30000);

  it("exec.command: runs a shell command", async () => {
    const run = await box.exec.command("echo hello-ephemeral");
    expect(run.result).toContain("hello-ephemeral");
    expect(run.status).toBe("completed");
    expect(run.exitCode).toBe(0);
  });

  it("exec.code: runs inline JavaScript", async () => {
    const run = await box.exec.code({
      code: "console.log(JSON.stringify({ product: 6 * 7 }))",
      lang: "js",
    });
    expect(run.exitCode).toBe(0);
    expect(run.result).toContain('"product":42');
  });

  it("exec.stream: streams shell output", async () => {
    const run = await box.exec.stream("for i in 1 2 3; do echo line-$i; done");
    const chunks: string[] = [];
    for await (const chunk of run) {
      if (chunk.type === "output") {
        chunks.push(chunk.data);
      }
    }
    const fullOutput = chunks.join("");
    expect(fullOutput).toContain("line-1");
    expect(fullOutput).toContain("line-2");
    expect(fullOutput).toContain("line-3");
    expect(run.status).toBe("completed");
  }, 15000);

  it("exec.streamCode: streams inline JS output", async () => {
    const run = await box.exec.streamCode({
      code: 'for (let i = 0; i < 3; i++) console.log("count-" + i);',
      lang: "js",
    });
    const chunks: string[] = [];
    for await (const chunk of run) {
      if (chunk.type === "output") {
        chunks.push(chunk.data);
      }
    }
    const fullOutput = chunks.join("");
    expect(fullOutput).toContain("count-0");
    expect(fullOutput).toContain("count-1");
    expect(fullOutput).toContain("count-2");
  }, 15000);

  it("files: write then read roundtrip", async () => {
    await box.files.write({ path: "test.txt", content: "ephemeral file content" });
    const content = await box.files.read("test.txt");
    expect(content).toBe("ephemeral file content");
  });

  it("files: list shows written file", async () => {
    const files = await box.files.list();
    const found = files.some((f) => f.name === "test.txt");
    expect(found).toBe(true);
  });

  it("files: upload sends a local file to the box", async () => {
    tmpDir = join(tmpdir(), `ephemeral-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    const localPath = join(tmpDir, "upload.txt");
    writeFileSync(localPath, "uploaded via ephemeral");

    await box.files.upload([{ path: localPath, destination: "uploaded.txt" }]);
    const content = await box.files.read("uploaded.txt");
    expect(content).toBe("uploaded via ephemeral");
  });

  it("getStatus: returns current status", async () => {
    const { status } = await box.getStatus();
    expect(status).toBeTruthy();
  });

  it("cd: changes working directory", async () => {
    await box.exec.command("mkdir -p subdir");
    await box.cd("subdir");
    expect(box.cwd).toBe("/workspace/home/subdir");
    // Reset
    await box.cd("/workspace/home");
  });
});

describe.skipIf(!UPSTASH_BOX_API_KEY)("EphemeralBox — python runtime", () => {
  let box: EphemeralBox;

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("creates an ephemeral box with python runtime", async () => {
    box = await EphemeralBox.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      runtime: "python",
      ttl: 300,
    });

    expect(box.id).toBeTruthy();
    expect(box.expiresAt).toBeGreaterThan(0);
  }, 30000);

  it("exec.command: runs a shell command", async () => {
    const run = await box.exec.command("python3 --version");
    expect(run.exitCode).toBe(0);
    expect(run.result.toLowerCase()).toContain("python");
  });

  it("exec.code: runs inline Python", async () => {
    const run = await box.exec.code({
      code: 'import json; print(json.dumps({"result": 2 ** 10}))',
      lang: "python",
    });
    expect(run.exitCode).toBe(0);
    expect(run.result).toContain('"result": 1024');
  });

  it("files: write and read in python box", async () => {
    await box.files.write({ path: "data.json", content: '{"key":"value"}' });
    const content = await box.files.read("data.json");
    expect(content).toBe('{"key":"value"}');
  });
});

describe.skipIf(!UPSTASH_BOX_API_KEY)("EphemeralBox — default config", () => {
  let box: EphemeralBox;

  afterAll(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  it("creates an ephemeral box with no runtime or ttl", async () => {
    box = await EphemeralBox.create({
      apiKey: UPSTASH_BOX_API_KEY!,
    });

    expect(box.id).toBeTruthy();
    expect(box.expiresAt).toBeGreaterThan(0);
  }, 30000);

  it("exec.command: runs a basic command", async () => {
    const run = await box.exec.command("uname -s");
    expect(run.exitCode).toBe(0);
    expect(run.result).toContain("Linux");
  });
});
