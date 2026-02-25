import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("../../auth.js", () => ({
  resolveToken: vi.fn((token?: string) => token ?? "resolved-token"),
}));

let readlineAnswers: string[] = [];
vi.mock("node:readline", () => ({
  default: {
    createInterface: vi.fn(() => ({
      question: vi.fn((_query: string, cb: (answer: string) => void) =>
        cb(readlineAnswers.shift() ?? "n"),
      ),
      close: vi.fn(),
    })),
  },
}));

import {
  initDemoCommand,
  generateEnvFile,
  generateMainTs,
  generateReadme,
} from "../../commands/init-demo.js";

describe("initDemoCommand", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let mkdirSpy: ReturnType<typeof vi.spyOn>;
  let writeSpy: ReturnType<typeof vi.spyOn>;
  let existsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: confirm "y", then "n" for run prompt
    readlineAnswers = ["y", "n"];
    exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mkdirSpy = vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
    writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation(() => undefined);
    existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(false);
  });

  afterEach(() => vi.restoreAllMocks());

  it("exits if directory already exists", async () => {
    existsSpy.mockReturnValue(true);

    await initDemoCommand({ token: "key", directory: "my-demo" });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Directory "my-demo" already exists'),
    );
  });

  it("aborts if user declines confirmation", async () => {
    readlineAnswers = ["n"];

    await initDemoCommand({ token: "key", directory: "test-demo" });

    expect(mkdirSpy).not.toHaveBeenCalled();
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("exits if --agent-model set without --agent-api-key", async () => {
    await initDemoCommand({ token: "key", agentModel: "model" });

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("--agent-api-key is required"));
  });

  it("creates directory and writes all files", async () => {
    await initDemoCommand({ token: "key", directory: "test-demo" });

    const absDir = path.resolve("test-demo");
    expect(mkdirSpy).toHaveBeenCalledWith(absDir, { recursive: true });

    // Should write .env, main.ts, README.md
    expect(writeSpy).toHaveBeenCalledTimes(3);

    const writtenPaths = writeSpy.mock.calls.map((call: unknown[]) => call[0] as string);
    expect(writtenPaths).toContain(path.join(absDir, ".env"));
    expect(writtenPaths).toContain(path.join(absDir, "main.ts"));
    expect(writtenPaths).toContain(path.join(absDir, "README.md"));
  });

  it("runs npm init and npm install", async () => {
    await initDemoCommand({ token: "key", directory: "test-demo" });

    const absDir = path.resolve("test-demo");
    expect(execSync).toHaveBeenCalledWith('npm init -y && npm pkg set type="module"', {
      cwd: absDir,
      stdio: "ignore",
    });
    expect(execSync).toHaveBeenCalledWith("npm install @upstash/box dotenv", {
      cwd: absDir,
      stdio: "ignore",
    });
    expect(execSync).toHaveBeenCalledWith("npm install --save-dev @types/node", {
      cwd: absDir,
      stdio: "ignore",
    });
  });

  it("uses default directory name 'box-demo'", async () => {
    await initDemoCommand({ token: "key" });

    const absDir = path.resolve("box-demo");
    expect(mkdirSpy).toHaveBeenCalledWith(absDir, { recursive: true });
  });
});

describe("generateEnvFile", () => {
  it("contains correct values", () => {
    const env = generateEnvFile(
      {
        token: "tok",
        agentModel: "claude/sonnet_4_5",
        agentApiKey: "ak",
        runtime: "python",
        gitToken: "gh-tok",
      },
      "my-token",
    );

    expect(env).toContain("UPSTASH_BOX_API_KEY=my-token");
    expect(env).toContain("AGENT_MODEL=claude/sonnet_4_5");
    expect(env).toContain("AGENT_API_KEY=ak");
    expect(env).toContain("RUNTIME=python");
    expect(env).toContain("GIT_TOKEN=gh-tok");
  });

  it("leaves optional values empty", () => {
    const env = generateEnvFile({}, "my-token");

    expect(env).toContain("UPSTASH_BOX_API_KEY=my-token");
    expect(env).toContain("AGENT_MODEL=");
    expect(env).toContain("AGENT_API_KEY=");
    expect(env).toContain("RUNTIME=node");
    expect(env).toContain("GIT_TOKEN=");
  });
});

describe("generateMainTs", () => {
  it("returns valid TypeScript content", () => {
    const content = generateMainTs("box-demo");

    expect(content).toContain('import "dotenv/config"');
    expect(content).toContain('import { Box } from "@upstash/box"');
    expect(content).toContain("Box.create(config)");
    expect(content).toContain('box.files.write({ path: "hello.txt"');
    expect(content).toContain('box.files.read("hello.txt")');
    expect(content).toContain('box.exec("ls -la")');
    expect(content).toContain("run.result");
    expect(content).toContain("box.agent.stream({");
    expect(content).toContain("box.pause()");
  });
});

describe("generateReadme", () => {
  it("includes the directory name", () => {
    const readme = generateReadme("my-project");
    expect(readme).toContain("cd my-project");
  });
});
