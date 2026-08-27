import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { COMPLETION_COMMANDS, completionCommand } from "../../commands/completion.js";

describe("box completion", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  const shell = process.env.SHELL;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    logSpy.mockRestore();
    if (shell === undefined) delete process.env.SHELL;
    else process.env.SHELL = shell;
  });

  const script = () => String(logSpy.mock.calls[0]?.[0] ?? "");

  function write(contents: string, extension: string): string {
    const file = path.join(mkdtempSync(path.join(tmpdir(), "box-completion-")), `c.${extension}`);
    writeFileSync(file, contents, "utf8");
    return file;
  }

  it("offers the commands the CLI actually has", () => {
    process.env.SHELL = "/bin/bash";
    completionCommand();
    // The non-interactive surface is the point of the CLI; leaving it out of
    // completion is how it stays invisible.
    for (const command of ["status", "exec", "files", "git", "expose", "run", "use"]) {
      expect(script()).toContain(command);
    }
  });

  it("emits a script bash can parse", () => {
    process.env.SHELL = "/bin/bash";
    completionCommand();
    expect(() => execFileSync("bash", ["-n", write(script(), "bash")])).not.toThrow();
  });

  it("emits a script zsh can parse", () => {
    process.env.SHELL = "/bin/zsh";
    completionCommand();
    // An apostrophe in a description ("the box's agent") ends zsh's quoting and
    // produces a script that will not load.
    expect(() => execFileSync("zsh", ["-n", write(script(), "zsh")])).not.toThrow();
  });

  it("completes subcommands, not just the top level", () => {
    process.env.SHELL = "/bin/zsh";
    completionCommand();
    expect(script()).toContain("create-pr");
    expect(script()).toContain("mkdir");
  });

  it("lists every command in both shells", () => {
    process.env.SHELL = "/bin/bash";
    completionCommand();
    const bash = script();
    for (const command of COMPLETION_COMMANDS) expect(bash).toContain(command);
  });
});
