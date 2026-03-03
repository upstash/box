import { describe, it, expect, beforeAll } from "vitest";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Box } from "../../index.js";
import { UPSTASH_BOX_API_KEY, withBox, withBoxFromSnapshot } from "./setup.js";

describe.skipIf(!UPSTASH_BOX_API_KEY)("cd / cwd", () => {
  let snapshotId: string;

  beforeAll(async () => {
    await withBox(async (setupBox) => {
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
    });
  }, 180000);

  const fromSnapshot = (fn: (box: Box) => Promise<void>) => withBoxFromSnapshot(snapshotId, fn);

  // ==================== cwd getter ====================

  it.concurrent(
    "defaults to /workspace/home",
    () =>
      fromSnapshot(async (box) => {
        expect(box.cwd).toBe("/workspace/home");
      }),
    120000,
  );

  // ==================== cd basics ====================

  it.concurrent(
    "cd into existing directory (relative)",
    () =>
      fromSnapshot(async (box) => {
        await box.cd("project-a");
        expect(box.cwd).toBe("/workspace/home/project-a");
      }),
    120000,
  );

  it.concurrent(
    "cd with absolute path",
    () =>
      fromSnapshot(async (box) => {
        await box.cd("/workspace/home/project-b");
        expect(box.cwd).toBe("/workspace/home/project-b");
      }),
    120000,
  );

  it.concurrent(
    "cd with ..",
    () =>
      fromSnapshot(async (box) => {
        await box.cd("project-a/src");
        expect(box.cwd).toBe("/workspace/home/project-a/src");

        await box.cd("..");
        expect(box.cwd).toBe("/workspace/home/project-a");

        await box.cd("..");
        expect(box.cwd).toBe("/workspace/home");
      }),
    120000,
  );

  it.concurrent(
    "cd with nested ..",
    () =>
      fromSnapshot(async (box) => {
        await box.cd("project-a/src");
        expect(box.cwd).toBe("/workspace/home/project-a/src");

        await box.cd("../../project-b");
        expect(box.cwd).toBe("/workspace/home/project-b");
      }),
    120000,
  );

  it.concurrent(
    "cd with ./relative",
    () =>
      fromSnapshot(async (box) => {
        await box.cd("project-a");
        await box.cd("./src");
        expect(box.cwd).toBe("/workspace/home/project-a/src");
      }),
    120000,
  );

  it.concurrent(
    "cd to non-existent directory throws",
    () =>
      fromSnapshot(async (box) => {
        await expect(box.cd("does-not-exist")).rejects.toThrow(
          "cd: does-not-exist: No such file or directory",
        );
        // cwd unchanged
        expect(box.cwd).toBe("/workspace/home");
      }),
    120000,
  );

  it.concurrent(
    "cd to non-existent absolute path throws",
    () =>
      fromSnapshot(async (box) => {
        await expect(box.cd("/workspace/home/nope/nada")).rejects.toThrow(
          "cd: /workspace/home/nope/nada: No such file or directory",
        );
        expect(box.cwd).toBe("/workspace/home");
      }),
    120000,
  );

  it.concurrent(
    "failed cd preserves previous cwd",
    () =>
      fromSnapshot(async (box) => {
        await box.cd("project-a");
        expect(box.cwd).toBe("/workspace/home/project-a");

        await expect(box.cd("nonexistent")).rejects.toThrow();
        expect(box.cwd).toBe("/workspace/home/project-a");
      }),
    120000,
  );

  // ==================== exec.command respects cwd ====================

  it.concurrent(
    "exec.command runs in cwd context",
    () =>
      fromSnapshot(async (box) => {
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
      }),
    120000,
  );

  it.concurrent(
    "exec.command in project-b",
    () =>
      fromSnapshot(async (box) => {
        await box.cd("project-b");
        const run = await box.exec.command("ls");
        expect(run.result).toContain("main.py");
      }),
    120000,
  );

  // ==================== exec.code respects cwd ====================

  it.concurrent(
    "exec.code runs in cwd context",
    () =>
      fromSnapshot(async (box) => {
        await box.cd("project-a");

        const result = await box.exec.code({
          code: 'const fs = require("fs"); console.log(fs.readdirSync(".").join(","))',
          lang: "js",
        });
        expect(result.exit_code).toBe(0);
        expect(result.output).toContain("src");
        expect(result.output).toContain("README.md");
      }),
    120000,
  );

  // ==================== files.read resolves against cwd ====================

  it.concurrent(
    "files.read resolves relative path against cwd",
    () =>
      fromSnapshot(async (box) => {
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
      }),
    120000,
  );

  it.concurrent(
    "files.read with absolute path ignores cwd",
    () =>
      fromSnapshot(async (box) => {
        await box.cd("project-b");

        // Absolute path should reach project-a even though cwd is project-b
        const content = await box.files.read("/workspace/home/project-a/README.md");
        expect(content.trim()).toBe("# Project A");
      }),
    120000,
  );

  // ==================== files.write resolves against cwd ====================

  it.concurrent(
    "files.write resolves relative path against cwd",
    () =>
      fromSnapshot(async (box) => {
        await box.cd("project-a");
        await box.files.write({ path: "new-file.txt", content: "written from cwd" });

        // Verify by reading with absolute path
        const content = await box.files.read("/workspace/home/project-a/new-file.txt");
        expect(content).toBe("written from cwd");
      }),
    120000,
  );

  it.concurrent(
    "files.write with absolute path ignores cwd",
    () =>
      fromSnapshot(async (box) => {
        await box.cd("project-a");
        await box.files.write({
          path: "/workspace/home/project-b/from-a.txt",
          content: "cross-project write",
        });

        await box.cd("/workspace/home/project-b");
        const content = await box.files.read("from-a.txt");
        expect(content).toBe("cross-project write");
      }),
    120000,
  );

  // ==================== files.list respects cwd ====================

  it.concurrent.skip(
    "files.list with no args lists cwd contents",
    () =>
      fromSnapshot(async (box) => {
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
      }),
    120000,
  );

  it.concurrent(
    "files.list with explicit path resolves against cwd",
    () =>
      fromSnapshot(async (box) => {
        await box.cd("project-a");

        const srcFiles = await box.files.list("src");
        const names = srcFiles.map((f) => f.name);
        expect(names).toContain("index.ts");
      }),
    120000,
  );

  // ==================== files.upload resolves destination against cwd ====================

  it.concurrent(
    "files.upload resolves destination against cwd",
    () =>
      fromSnapshot(async (box) => {
        const tmpDir = join(
          tmpdir(),
          `box-cd-upload-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        );
        mkdirSync(tmpDir, { recursive: true });
        try {
          const localPath = join(tmpDir, "upload-cd-test.txt");
          writeFileSync(localPath, "uploaded to cwd");

          await box.cd("project-b");
          await box.files.upload([{ path: localPath, destination: "uploaded-via-cd.txt" }]);

          // Verify the file landed in project-b
          const content = await box.files.read("/workspace/home/project-b/uploaded-via-cd.txt");
          expect(content).toBe("uploaded to cwd");
        } finally {
          rmSync(tmpDir, { recursive: true, force: true });
        }
      }),
    120000,
  );

  // ==================== git operations respect cwd ====================

  it.concurrent(
    "git.clone then cd into cloned repo and use git ops",
    () =>
      fromSnapshot(async (box) => {
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
      }),
    120000,
  );

  it.concurrent(
    "git.exec respects cwd",
    () =>
      fromSnapshot(async (box) => {
        await box.cd("project-a");
        await box.exec.command("git init && git add -A && git commit -m 'init'");
        await box.files.write({ path: "new.txt", content: "change" });
        await box.exec.command("git add new.txt && git commit -m 'add new.txt'");

        const result = await box.git.exec({ args: ["log", "--oneline", "-1"] });
        expect(result.output).toContain("add new.txt");
      }),
    120000,
  );

  it.concurrent(
    "git.checkout respects cwd",
    () =>
      fromSnapshot(async (box) => {
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
      }),
    120000,
  );

  it.concurrent(
    "git.exec in different cwd sees different repos",
    () =>
      fromSnapshot(async (box) => {
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
      }),
    120000,
  );

  it.concurrent(
    "git operations in project-b are independent from project-a",
    () =>
      fromSnapshot(async (box) => {
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
      }),
    120000,
  );

  // ==================== multi-folder workflow ====================

  it.concurrent.skip(
    "full multi-folder workflow: create, cd, write, read, list, exec, cd, repeat",
    () =>
      fromSnapshot(async (box) => {
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
      }),
    120000,
  );

  // ==================== error: cd to deeply nested non-existent path ====================

  it.concurrent(
    "cd to deeply nested non-existent path throws",
    () =>
      fromSnapshot(async (box) => {
        await expect(box.cd("project-a/src/deep/missing/folder")).rejects.toThrow();
        expect(box.cwd).toBe("/workspace/home");
      }),
    120000,
  );

  // ==================== rapid cd and verify state ====================

  it.concurrent(
    "rapid sequential cd calls maintain consistent state",
    () =>
      fromSnapshot(async (box) => {
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
      }),
    120000,
  );
});
