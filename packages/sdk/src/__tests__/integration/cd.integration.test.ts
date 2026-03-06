import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Box, ClaudeCode } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";

describe.skipIf(!UPSTASH_BOX_API_KEY)("cd / cwd", () => {
  let snapshotId: string;
  let box: Box;
  let tmpDir: string;

  beforeAll(async () => {
    const setupBox = await Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: { model: ClaudeCode.Sonnet_4_5 },
    });

    tmpDir = join(tmpdir(), `box-cd-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    // Create folder structure on the box:
    //   /workspace/home/
    //     project-a/  (src/index.ts, README.md)
    //     project-b/  (main.py)
    await setupBox.exec.command(
      [
        "mkdir -p project-a/src project-b",
        "echo 'export const a = 1;' > project-a/src/index.ts",
        "echo '# Project A' > project-a/README.md",
        "echo \"print('hello')\" > project-b/main.py",
      ].join(" && "),
    );

    const snapshot = await setupBox.snapshot({ name: `cd-test-${Date.now()}` });
    snapshotId = snapshot.id;
    await setupBox.delete();
  }, 180000);

  afterAll(async () => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  beforeEach(async () => {
    box = await Box.fromSnapshot(snapshotId, {
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: { model: ClaudeCode.Sonnet_4_5 },
    });
  }, 120000);

  afterEach(async () => {
    try {
      await box?.delete();
    } catch {
      // cleanup best-effort
    }
  }, 30000);

  // ==================== cwd getter ====================

  it("defaults to /workspace/home", () => {
    expect(box.cwd).toBe("/workspace/home");
  });

  // ==================== cd basics ====================

  it("cd into existing directory (relative)", async () => {
    await box.cd("project-a");
    expect(box.cwd).toBe("/workspace/home/project-a");
  });

  it("cd with absolute path", async () => {
    await box.cd("/workspace/home/project-b");
    expect(box.cwd).toBe("/workspace/home/project-b");
  });

  it("cd with ..", async () => {
    await box.cd("project-a/src");
    expect(box.cwd).toBe("/workspace/home/project-a/src");

    await box.cd("..");
    expect(box.cwd).toBe("/workspace/home/project-a");

    await box.cd("..");
    expect(box.cwd).toBe("/workspace/home");
  });

  it("cd with nested ..", async () => {
    await box.cd("project-a/src");
    expect(box.cwd).toBe("/workspace/home/project-a/src");

    await box.cd("../../project-b");
    expect(box.cwd).toBe("/workspace/home/project-b");
  });

  it("cd with ./relative", async () => {
    await box.cd("project-a");
    await box.cd("./src");
    expect(box.cwd).toBe("/workspace/home/project-a/src");
  });

  it("cd to non-existent directory throws", async () => {
    await expect(box.cd("does-not-exist")).rejects.toThrow(
      "cd: does-not-exist: No such file or directory",
    );
    // cwd unchanged
    expect(box.cwd).toBe("/workspace/home");
  });

  it("cd to non-existent absolute path throws", async () => {
    await expect(box.cd("/workspace/home/nope/nada")).rejects.toThrow(
      "cd: /workspace/home/nope/nada: No such file or directory",
    );
    expect(box.cwd).toBe("/workspace/home");
  });

  it("failed cd preserves previous cwd", async () => {
    await box.cd("project-a");
    expect(box.cwd).toBe("/workspace/home/project-a");

    await expect(box.cd("nonexistent")).rejects.toThrow();
    expect(box.cwd).toBe("/workspace/home/project-a");
  });

  // ==================== exec.command respects cwd ====================

  it("exec.command runs in cwd context", async () => {
    // At workspace root, ls should show project-a and project-b
    const rootRun = await box.exec.command("ls");
    expect(rootRun.result).toContain("project-a");
    expect(rootRun.result).toContain("project-b");

    // cd into project-a, ls should show src and README.md
    await box.cd("project-a");
    const projectRun = await box.exec.command("ls");
    expect(projectRun.result).toContain("src");
    expect(projectRun.result).toContain("README.md");

    // cd deeper into src
    await box.cd("src");
    const srcRun = await box.exec.command("ls");
    expect(srcRun.result).toContain("index.ts");
  });

  it("exec.command in project-b", async () => {
    await box.cd("project-b");
    const run = await box.exec.command("ls");
    expect(run.result).toContain("main.py");
  });

  // ==================== exec.code respects cwd ====================

  it("exec.code runs in cwd context", async () => {
    await box.cd("project-a");

    const result = await box.exec.code({
      code: 'const fs = require("fs"); console.log(fs.readdirSync(".").join(","))',
      lang: "js",
    });
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("src");
    expect(result.output).toContain("README.md");
  });

  // ==================== files.read resolves against cwd ====================

  it("files.read resolves relative path against cwd", async () => {
    // Read from workspace root
    const rootContent = await box.files.read("project-a/README.md");
    expect(rootContent.trim()).toBe("# Project A");

    // cd into project-a, read with shorter relative path
    await box.cd("project-a");
    const cdContent = await box.files.read("README.md");
    expect(cdContent.trim()).toBe("# Project A");

    // cd deeper, read with relative path
    await box.cd("src");
    const srcContent = await box.files.read("index.ts");
    expect(srcContent.trim()).toBe("export const a = 1;");
  });

  it("files.read with absolute path ignores cwd", async () => {
    await box.cd("project-b");

    // Absolute path should reach project-a even though cwd is project-b
    const content = await box.files.read("/workspace/home/project-a/README.md");
    expect(content.trim()).toBe("# Project A");
  });

  // ==================== files.write resolves against cwd ====================

  it("files.write resolves relative path against cwd", async () => {
    await box.cd("project-a");
    await box.files.write({ path: "new-file.txt", content: "written from cwd" });

    // Verify by reading with absolute path
    const content = await box.files.read("/workspace/home/project-a/new-file.txt");
    expect(content).toBe("written from cwd");
  });

  it("files.write with absolute path ignores cwd", async () => {
    await box.cd("project-a");
    await box.files.write({
      path: "/workspace/home/project-b/from-a.txt",
      content: "cross-project write",
    });

    await box.cd("/workspace/home/project-b");
    const content = await box.files.read("from-a.txt");
    expect(content).toBe("cross-project write");
  });

  // ==================== files.list respects cwd ====================

  it("files.list with no args lists cwd contents", async () => {
    // At root
    const rootFiles = await box.files.list();
    const rootNames = rootFiles.map((f) => f.name);
    expect(rootNames).toContain("project-a");
    expect(rootNames).toContain("project-b");

    // cd into project-a
    await box.cd("project-a");
    const projectFiles = await box.files.list();
    const projectNames = projectFiles.map((f) => f.name);
    expect(projectNames).toContain("src");
    expect(projectNames).toContain("README.md");
    expect(projectNames).not.toContain("project-b");

    // cd into src
    await box.cd("src");
    const srcFiles = await box.files.list();
    const srcNames = srcFiles.map((f) => f.name);
    expect(srcNames).toContain("index.ts");
  });

  it("files.list with explicit path resolves against cwd", async () => {
    await box.cd("project-a");

    const srcFiles = await box.files.list("src");
    const names = srcFiles.map((f) => f.name);
    expect(names).toContain("index.ts");
  });

  // ==================== files.upload resolves destination against cwd ====================

  it("files.upload resolves destination against cwd", async () => {
    const localPath = join(tmpDir, "upload-cd-test.txt");
    writeFileSync(localPath, "uploaded to cwd");

    await box.cd("project-b");
    await box.files.upload([{ path: localPath, destination: "uploaded-via-cd.txt" }]);

    // Verify the file landed in project-b
    const content = await box.files.read("/workspace/home/project-b/uploaded-via-cd.txt");
    expect(content).toBe("uploaded to cwd");
  });

  // ==================== git operations respect cwd ====================

  it("git.clone then cd into cloned repo and use git ops", async () => {
    await box.cd("project-a");
    await box.exec.command("git init && git add -A && git commit -m 'init'");

    const status = await box.git.status();
    expect(status).toBeDefined();

    // Make a change
    await box.files.write({ path: "new.txt", content: "change" });
    await box.exec.command("git add new.txt");

    const diff = await box.git.diff();
    expect(diff).toBeDefined();

    const commit = await box.git.commit({ message: "add new.txt" });
    expect(commit.sha).toBeTruthy();
    expect(commit.message).toContain("add new.txt");
  });

  it("git.exec respects cwd", async () => {
    await box.cd("project-a");
    await box.exec.command("git init && git add -A && git commit -m 'init'");
    await box.files.write({ path: "new.txt", content: "change" });
    await box.exec.command("git add new.txt && git commit -m 'add new.txt'");

    const result = await box.git.exec({ args: ["log", "--oneline", "-1"] });
    expect(result.output).toContain("add new.txt");
  });

  it("git.checkout respects cwd", async () => {
    await box.cd("project-a");
    await box.exec.command("git init && git add -A && git commit -m 'init'");

    // Create a new branch and switch to it
    await box.git.exec({ args: ["branch", "test-branch"] });
    await box.git.checkout({ branch: "test-branch" });

    const branchResult = await box.git.exec({ args: ["branch", "--show-current"] });
    expect(branchResult.output.trim()).toBe("test-branch");

    // Switch back to the default branch
    await box.git.checkout({ branch: "master" });
    const backResult = await box.git.exec({ args: ["branch", "--show-current"] });
    expect(backResult.output.trim()).toBe("master");
  });

  it("git.exec in different cwd sees different repos", async () => {
    // Set up project-a git repo
    await box.cd("project-a");
    await box.exec.command("git init && git add -A && git commit -m 'init'");
    await box.files.write({ path: "new.txt", content: "change" });
    await box.exec.command("git add new.txt && git commit -m 'add new.txt'");

    // Set up project-b git repo
    await box.cd("/workspace/home/project-b");
    await box.exec.command("git init && git add -A && git commit -m 'init b'");

    // project-a log should reference "add new.txt"
    await box.cd("/workspace/home/project-a");
    const aLog = await box.git.exec({ args: ["log", "--oneline"] });
    expect(aLog.output).toContain("add new.txt");

    // project-b log should reference "init b", not "add new.txt"
    await box.cd("/workspace/home/project-b");
    const bLog = await box.git.exec({ args: ["log", "--oneline"] });
    expect(bLog.output).toContain("init b");
    expect(bLog.output).not.toContain("add new.txt");
  });

  it("git operations in project-b are independent from project-a", async () => {
    // Set up project-a git repo
    await box.cd("project-a");
    await box.exec.command("git init && git add -A && git commit -m 'init a'");

    // Set up and test project-b git repo
    await box.cd("/workspace/home/project-b");
    await box.exec.command("git init && git add -A && git commit -m 'init b'");

    const status = await box.git.status();
    expect(status).toBeDefined();

    await box.files.write({ path: "extra.py", content: "x = 1" });
    await box.exec.command("git add extra.py");
    const commit = await box.git.commit({ message: "add extra" });
    expect(commit.sha).toBeTruthy();
  });

  // ==================== multi-folder workflow ====================

  it("full multi-folder workflow: create, cd, write, read, list, exec, cd, repeat", async () => {
    // Create a third project
    await box.exec.command("mkdir -p project-c/lib");
    await box.cd("project-c");
    expect(box.cwd).toBe("/workspace/home/project-c");

    // Write files relative to cwd
    await box.files.write({ path: "lib/utils.ts", content: "export const c = 3;" });
    await box.files.write({ path: "index.ts", content: "import { c } from './lib/utils';" });

    // List shows the files
    const files = await box.files.list();
    const names = files.map((f) => f.name);
    expect(names).toContain("lib");
    expect(names).toContain("index.ts");

    // Read back
    const content = await box.files.read("lib/utils.ts");
    expect(content).toBe("export const c = 3;");

    // Exec in context
    const run = await box.exec.command("cat index.ts");
    expect(run.result).toContain("import { c }");

    // Now switch to project-a
    await box.cd("/workspace/home/project-a");
    expect(box.cwd).toBe("/workspace/home/project-a");

    // project-a's files, not project-c's
    const aFiles = await box.files.list();
    const aNames = aFiles.map((f) => f.name);
    expect(aNames).toContain("README.md");
    expect(aNames).not.toContain("lib");

    // Switch to project-b using ..
    await box.cd("../project-b");
    expect(box.cwd).toBe("/workspace/home/project-b");
    const bContent = await box.files.read("main.py");
    expect(bContent.trim()).toBe("print('hello')");
  });

  // ==================== error: cd to deeply nested non-existent path ====================

  it("cd to deeply nested non-existent path throws", async () => {
    await expect(box.cd("project-a/src/deep/missing/folder")).rejects.toThrow();
    expect(box.cwd).toBe("/workspace/home");
  });

  // ==================== rapid cd and verify state ====================

  it("rapid sequential cd calls maintain consistent state", async () => {
    // Create project-c needed for this test
    await box.exec.command("mkdir -p project-c/lib");

    await box.cd("project-a");
    expect(box.cwd).toBe("/workspace/home/project-a");

    await box.cd("src");
    expect(box.cwd).toBe("/workspace/home/project-a/src");

    await box.cd("../..");
    expect(box.cwd).toBe("/workspace/home");

    await box.cd("project-b");
    expect(box.cwd).toBe("/workspace/home/project-b");

    await box.cd("/workspace/home/project-c/lib");
    expect(box.cwd).toBe("/workspace/home/project-c/lib");

    await box.cd("../..");
    expect(box.cwd).toBe("/workspace/home");
  });

  // ==================== agent respects cwd ====================

  it("agent.run respects cwd after cd", async () => {
    await box.agent.run({
      prompt: "say hi!",
    });

    await box.cd("project-a");

    const run = await box.agent.run({
      prompt: "Read the file README.md in the current directory and reply with its exact contents, nothing else.",
    });

    expect(run.result).toContain("# Project A");
  }, 120000);
});
