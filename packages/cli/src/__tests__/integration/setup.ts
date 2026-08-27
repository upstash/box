import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const here = path.dirname(fileURLToPath(import.meta.url));
// dotenv does not overwrite what is already set, so the most specific source
// is loaded first: a real environment variable, then the SDK's .env, then the
// repository's.
dotenv.config({ path: path.resolve(here, "../../../../sdk/.env") });
dotenv.config({ path: path.resolve(here, "../../../../../.env") });

export const UPSTASH_BOX_API_KEY = process.env.UPSTASH_BOX_API_KEY;

/** The built CLI, which is what these tests exercise. */
export const CLI = path.resolve(here, "../../../dist/cli.js");

/**
 * Run the CLI the way a script would, in its own directory.
 *
 * Spawning the real binary is the point: argument parsing, the stdout/stderr
 * split and exit codes only exist at the process boundary and cannot be
 * observed by calling a command function.
 */
export function makeRunner(cwd: string) {
  return function run(...args: string[]): SpawnSyncReturns<string> {
    return spawnSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, UPSTASH_BOX_API_KEY, NO_COLOR: "1" },
    });
  };
}

/** Run the CLI with something on its stdin, for the `-` forms. */
export function makeStdinRunner(cwd: string) {
  return function run(input: string, ...args: string[]): SpawnSyncReturns<string> {
    return spawnSync(process.execPath, [CLI, ...args], {
      cwd,
      input,
      encoding: "utf8",
      env: { ...process.env, UPSTASH_BOX_API_KEY, NO_COLOR: "1" },
    });
  };
}

/** A throwaway directory, so `.box` files cannot leak between tests. */
export function workingDirectory(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "box-cli-it-"));
  return { path: dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
