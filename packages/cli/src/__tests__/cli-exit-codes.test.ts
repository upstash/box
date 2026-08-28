import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { CLI_FAILURE_EXIT_CODE } from "../core/errors.js";

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dist/cli.js");
const built = existsSync(CLI);

/**
 * Commander reports usage errors before any action runs, so this convention
 * cannot be checked by calling a command function. It has to run the binary.
 */
describe.skipIf(!built)("exit codes at the program boundary", () => {
  function run(...args: string[]) {
    return spawnSync(process.execPath, [CLI, ...args], {
      encoding: "utf8",
      env: { ...process.env, UPSTASH_BOX_API_KEY: "box_test" },
    });
  }

  it.each([
    ["an unknown option", ["exec", "--no-such-flag", "--", "ls"]],
    ["an unknown command", ["no-such-command"]],
    ["an unknown subcommand", ["files", "no-such-verb"]],
    ["a missing required argument", ["files", "read"]],
    ["a missing subcommand argument", ["expose", "delete"]],
  ])("uses %s exits %i", (_what, args) => {
    // Commander's default is 1, which is indistinguishable from a remote
    // command that exited 1 — the ambiguity 125 exists to remove.
    expect(run(...(args as string[])).status).toBe(CLI_FAILURE_EXIT_CODE);
  });

  it.each([
    ["--help", ["--help"]],
    ["--version", ["--version"]],
    ["subcommand help", ["files", "--help"]],
    ["nested subcommand help", ["git", "checkout", "--help"]],
    ["the help command", ["help", "files"]],
  ])("%s succeeds", (_what, args) => {
    expect(run(...(args as string[])).status).toBe(0);
  });

  it("still explains what was wrong", () => {
    const result = run("exec", "--no-such-flag", "--", "ls");
    expect(`${result.stderr}${result.stdout}`).toContain("--no-such-flag");
  });

  it("explains it exactly once", () => {
    // Commander writes its own diagnostic before exitOverride throws, so
    // reporting the thrown message too printed every usage error twice.
    const result = run("exec", "--no-such-flag", "--", "ls");
    const combined = `${result.stderr}${result.stdout}`;
    expect(combined.split("--no-such-flag").length - 1).toBe(1);
  });
});
