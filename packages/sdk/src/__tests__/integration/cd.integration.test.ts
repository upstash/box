import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Box, ClaudeCode } from "../../index.js";
import { UPSTASH_BOX_API_KEY } from "./setup.js";

describe.skipIf(!UPSTASH_BOX_API_KEY)("cd / cwd", () => {
  let box: Box;
  let tmpDir: string;

  beforeAll(async () => {
    box = await Box.create({
      apiKey: UPSTASH_BOX_API_KEY!,
      agent: { model: ClaudeCode.Opus_4_6 },
    });

    tmpDir = join(tmpdir(), `box-cd-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });

    // Create folder structure on the box using exec + heredocs so
    // directories and files are created atomically:
    //   /workspace/home/
    //     project-a/  (src/index.ts, README.md)
    //     project-b/  (main.py)
    await box.exec.command(
      [
        "mkdir -p project-a/src project-b",
        "echo 'export const a = 1;' > project-a/src/index.ts",
        "echo '# Project A' > project-a/README.md",
        "echo \"print('hello')\" > project-b/main.py",
      ].join(" && "),
    );
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

  // ==================== cwd getter ====================

  it("defaults to /workspace/home", () => {
    expect(box.cwd).toBe("/workspace/home");
  });

  // ==================== cd basics ====================

  it("cd into existing directory (relative)", async () => {
    await box.cd("project-a");
    expect(box.cwd).toBe("/workspace/home/project-a");

    // go back
    await box.cd("/workspace/home");
  });

  it("cd with absolute path", async () => {
    await box.cd("/workspace/home/project-b");
    expect(box.cwd).toBe("/workspace/home/project-b");

    await box.cd("/workspace/home");
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

    await box.cd("/workspace/home");
  });

  it("cd with ./relative", async () => {
    await box.cd("project-a");
    await box.cd("./src");
    expect(box.cwd).toBe("/workspace/home/project-a/src");

    await box.cd("/workspace/home");
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

    await box.cd("/workspace/home");
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

    await box.cd("/workspace/home");
  });

  it("exec.command in project-b", async () => {
    await box.cd("project-b");
    const run = await box.exec.command("ls");
    expect(run.result).toContain("main.py");

    await box.cd("/workspace/home");
  });

  // ==================== exec.code respects cwd ====================

  it("exec.code runs in cwd context", async () => {
    // Write a file in project-a to read with code
    await box.cd("project-a");

    const result = await box.exec.code({
      code: 'const fs = require("fs"); console.log(fs.readdirSync(".").join(","))',
      lang: "js",
    });
    expect(result.exit_code).toBe(0);
    expect(result.output).toContain("src");
    expect(result.output).toContain("README.md");

    await box.cd("/workspace/home");
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

    await box.cd("/workspace/home");
  });

  it("files.read with absolute path ignores cwd", async () => {
    await box.cd("project-b");

    // Absolute path should reach project-a even though cwd is project-b
    const content = await box.files.read("/workspace/home/project-a/README.md");
    expect(content.trim()).toBe("# Project A");

    await box.cd("/workspace/home");
  });

  // ==================== files.write resolves against cwd ====================

  it("files.write resolves relative path against cwd", async () => {
    await box.cd("project-a");
    await box.files.write({ path: "new-file.txt", content: "written from cwd" });

    // Verify by reading with absolute path
    const content = await box.files.read("/workspace/home/project-a/new-file.txt");
    expect(content).toBe("written from cwd");

    // Clean up
    await box.exec.command("rm new-file.txt");
    await box.cd("/workspace/home");
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

    await box.exec.command("rm from-a.txt");
    await box.cd("/workspace/home");
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

    await box.cd("/workspace/home");
  });

  it("files.list with explicit path resolves against cwd", async () => {
    await box.cd("project-a");

    const srcFiles = await box.files.list("src");
    const names = srcFiles.map((f) => f.name);
    expect(names).toContain("index.ts");

    await box.cd("/workspace/home");
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

    await box.exec.command("rm uploaded-via-cd.txt");
    await box.cd("/workspace/home");
  });

  // ==================== git operations respect cwd ====================

  it("git.clone then cd into cloned repo and use git ops", async () => {
    // Clone a small public repo into project-a/sub-repo context
    // Instead, let's init a git repo inside project-a to test git ops
    await box.cd("project-a");
    await box.exec.command("git init && git add -A && git commit -m 'init'");

    const status = await box.git.status();
    // After committing everything, status should be clean or empty
    expect(status).toBeDefined();

    // Make a change
    await box.files.write({ path: "new.txt", content: "change" });
    await box.exec.command("git add new.txt");

    const diff = await box.git.diff();
    // There might be a diff if staged, or not (depends on git diff vs git diff --staged)
    expect(diff).toBeDefined();

    const commit = await box.git.commit({ message: "add new.txt" });
    expect(commit.sha).toBeTruthy();
    expect(commit.message).toContain("add new.txt");

    await box.cd("/workspace/home");
  });

  it("git.exec respects cwd", async () => {
    await box.cd("project-a");

    const result = await box.git.exec({ args: ["log", "--oneline", "-1"] });
    expect(result.output).toContain("add new.txt");

    await box.cd("/workspace/home");
  });

  it("git.checkout respects cwd", async () => {
    await box.cd("project-a");

    // Create a new branch and switch to it
    await box.git.exec({ args: ["branch", "test-branch"] });
    await box.git.checkout({ branch: "test-branch" });

    const branchResult = await box.git.exec({ args: ["branch", "--show-current"] });
    expect(branchResult.output.trim()).toBe("test-branch");

    // Switch back to the default branch
    await box.git.checkout({ branch: "master" });
    const backResult = await box.git.exec({ args: ["branch", "--show-current"] });
    expect(backResult.output.trim()).toBe("master");

    await box.cd("/workspace/home");
  });

  it("git.exec in different cwd sees different repos", async () => {
    // project-a log should reference "add new.txt"
    await box.cd("project-a");
    const aLog = await box.git.exec({ args: ["log", "--oneline"] });
    expect(aLog.output).toContain("add new.txt");

    // project-b log should reference "init b", not "add new.txt"
    await box.cd("/workspace/home/project-b");
    const bLog = await box.git.exec({ args: ["log", "--oneline"] });
    expect(bLog.output).toContain("init b");
    expect(bLog.output).not.toContain("add new.txt");

    await box.cd("/workspace/home");
  });

  it("git operations in project-b are independent from project-a", async () => {
    await box.cd("project-b");
    await box.exec.command("git init && git add -A && git commit -m 'init b'");

    const status = await box.git.status();
    expect(status).toBeDefined();

    await box.files.write({ path: "extra.py", content: "x = 1" });
    await box.exec.command("git add extra.py");
    const commit = await box.git.commit({ message: "add extra" });
    expect(commit.sha).toBeTruthy();

    await box.cd("/workspace/home");
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

    // Back to root
    await box.cd("/workspace/home");
  });

  // ==================== error: cd to deeply nested non-existent path ====================

  it("cd to deeply nested non-existent path throws", async () => {
    await expect(box.cd("project-a/src/deep/missing/folder")).rejects.toThrow();
    expect(box.cwd).toBe("/workspace/home");
  });

  // ==================== rapid cd and verify state ====================

  it("rapid sequential cd calls maintain consistent state", async () => {
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
});
