import { readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { CliError } from "./errors.js";
import { note } from "./io.js";

/** Name of the file that records the box a directory works against. */
export const BOX_FILE = ".box";

/** Where a resolved box id came from, in precedence order. */
export type BoxIdSource = "flag" | "env" | "file";

export type ResolvedBoxId = {
  id: string;
  source: BoxIdSource;
  /** Absolute path of the `.box` that supplied it, when the source is a file. */
  path?: string;
};

/**
 * Find the nearest `.box`, searching upwards like git does for `.git`.
 *
 * Cwd-only lookup would fail the moment an agent stepped into `src/`, which is
 * the normal thing to do.
 * @param from - directory to start from.
 * @returns the file's absolute path, or undefined when there is none.
 */
export function findBoxFile(from: string): string | undefined {
  return searchBoxFiles(from).found;
}

/**
 * Read this directory's own `.box`, without walking up.
 *
 * Deliberately cwd-only: a parent's pin belongs to the project, not to the
 * command being run here, which is the same reasoning as `clearBoxFile`.
 * @param cwd - directory to look in.
 * @returns the file's path and the id it holds, or undefined when there is
 * none or it is empty.
 */
export function readOwnBoxFile(
  cwd: string = process.cwd(),
): { path: string; id: string } | undefined {
  const own = path.join(path.resolve(cwd), BOX_FILE);
  if (!existsSync(own)) return undefined;
  const id = readFileSync(own, "utf8").trim();
  return id ? { path: own, id } : undefined;
}

/**
 * Walk upwards collecting the first usable `.box` and any empty ones passed.
 *
 * An empty file is treated as absent rather than as a dead end: stopping there
 * would hide a valid pin in a parent directory. The empty ones are reported so
 * a malformed file can still be named instead of silently ignored.
 * @param from - directory to start from.
 * @returns the first file with content, plus every empty file seen on the way.
 */
export function searchBoxFiles(from: string): { found?: string; empty: string[] } {
  const empty: string[] = [];
  let directory = path.resolve(from);
  for (;;) {
    const candidate = path.join(directory, BOX_FILE);
    if (existsSync(candidate)) {
      if (readFileSync(candidate, "utf8").trim()) return { found: candidate, empty };
      empty.push(candidate);
    }
    const parent = path.dirname(directory);
    if (parent === directory) return { empty };
    directory = parent;
  }
}

/**
 * Resolve which box a command should act on.
 *
 * Explicit beats ambient: a flag beats the environment, which beats a file
 * found on disk. The environment coming before the file matters in CI, where a
 * checked-out `.box` from someone else's machine must not win over the id the
 * job was given.
 * @param options - the flag value, plus overrides used by tests.
 * @returns the id and where it came from.
 * @throws CliError when no source supplies one.
 */
export function resolveBoxId(options?: {
  flag?: string | undefined;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}): ResolvedBoxId {
  const env = options?.env ?? process.env;
  const cwd = options?.cwd ?? process.cwd();

  const flag = options?.flag?.trim();
  if (flag) return { id: flag, source: "flag" };

  const fromEnv = env.BOX_ID?.trim();
  if (fromEnv) return { id: fromEnv, source: "env" };

  const { found, empty } = searchBoxFiles(cwd);
  if (found !== undefined) {
    return { id: readFileSync(found, "utf8").trim(), source: "file", path: found };
  }

  // Naming an empty file is the difference between "you have no box" and "the
  // pin you think you have is blank".
  const emptyNote = empty.length > 0 ? ` Found an empty ${BOX_FILE} at ${empty[0]}.` : "";
  throw new CliError(
    `No box selected. Pass --box <id>, set BOX_ID, or run 'box use <id>' to write a ${BOX_FILE} file.${emptyNote}`,
  );
}

/**
 * One line naming the box in use and where that came from.
 *
 * Printed to stderr on every invocation, not once per session: each command is
 * a new process, and an inherited `.box` from a parent directory is exactly the
 * case worth seeing. Keeping it off stdout leaves `--json` parseable.
 * @param resolved - the outcome of {@link resolveBoxId}.
 * @returns the banner text.
 */
export function boxBanner(resolved: ResolvedBoxId): string {
  if (resolved.source === "flag") return `box: ${resolved.id} (from --box)`;
  if (resolved.source === "env") return `box: ${resolved.id} (from BOX_ID)`;
  return `box: ${resolved.id} (from ${resolved.path})`;
}

/**
 * Record the box a directory works against.
 * @param id - box id to write.
 * @param cwd - directory to write it in.
 * @returns the absolute path written.
 */
export function writeBoxFile(id: string, cwd: string = process.cwd()): string {
  const file = path.join(path.resolve(cwd), BOX_FILE);
  writeFileSync(file, `${id}\n`, "utf8");
  return file;
}

/**
 * Remove this directory's own `.box`.
 *
 * Deliberately does NOT walk up: unsetting from a subdirectory would delete the
 * project's pin, which is the same silent-wrong-directory failure the walk-up
 * on resolution is careful to make visible.
 * @param cwd - directory whose file should be removed.
 * @returns the path removed.
 * @throws CliError when this directory has no file of its own.
 */
export function clearBoxFile(cwd: string = process.cwd()): string {
  const own = path.join(path.resolve(cwd), BOX_FILE);
  if (!existsSync(own)) {
    const nearest = findBoxFile(cwd);
    const hint =
      nearest === undefined
        ? ""
        : ` The nearest one is ${nearest}; remove it from its own directory if that is what you meant.`;
    throw new CliError(`No ${BOX_FILE} in this directory.${hint}`);
  }
  rmSync(own);
  return own;
}

/**
 * Print which box is in use, and warn when an ambient file is being shadowed.
 *
 * Every command that resolves a box calls this, so the dangerous case — the
 * environment quietly winning over a `.box` on disk — is visible everywhere
 * rather than only where someone remembered to mention it.
 * @param resolved - the outcome of {@link resolveBoxId}.
 * @param cwd - directory to check for a shadowed file.
 */
export function announceBox(resolved: ResolvedBoxId, cwd: string = process.cwd()): void {
  note(boxBanner(resolved));
  if (resolved.source !== "env") return;
  const shadowed = findBoxFile(cwd);
  if (shadowed !== undefined) {
    note(`BOX_ID is set, so it takes precedence over ${shadowed}`);
  }
}
