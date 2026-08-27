import path from "node:path";
import readline from "node:readline";
import { Box } from "@upstash/box";
import {
  announceBox,
  clearBoxFile,
  findBoxFile,
  readOwnBoxFile,
  resolveBoxId,
} from "../core/box-ref.js";
import { CliError } from "../core/errors.js";
import { emit, isInteractive, note, requireToken, type GlobalFlags } from "../core/io.js";

export type LifecycleFlags = GlobalFlags & {
  /** Skip the confirmation prompt. Required when there is no terminal. */
  yes?: boolean;
};

/**
 * Ask for confirmation on a terminal.
 * @param question - the prompt.
 * @returns whether the answer was yes.
 */
export async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await new Promise<string>((resolve) => {
      // Without the close handler an end-of-input never settles the promise,
      // and the command exits having silently done nothing.
      rl.on("close", () => resolve(""));
      rl.question(question, resolve);
    });
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/**
 * Delete a box and everything in it.
 *
 * Irreversible, so it asks first. With no terminal to ask, it refuses unless
 * `--yes` was passed: a script that deletes a box it did not mean to has no
 * way to get the work back.
 * @param boxId - box to delete, or undefined to use the resolved one.
 * @param flags - global flags plus --yes.
 */
export async function deleteCommand(
  boxId: string | undefined,
  flags: LifecycleFlags,
): Promise<void> {
  const resolved = resolveBoxId({ flag: boxId ?? flags.box });
  announceBox(resolved);

  if (!flags.yes) {
    if (!isInteractive() || !process.stdin.isTTY) {
      throw new CliError(
        `Refusing to delete ${resolved.id} without confirmation. Pass --yes to proceed.`,
      );
    }
    const ok = await confirm(`Delete ${resolved.id} and everything in it? [y/N] `);
    if (!ok) {
      note("Left alone.");
      return;
    }
  }

  const box = await Box.get(resolved.id, { apiKey: requireToken(flags.token) });
  await box.delete();

  // A .box pointing at a deleted box makes every later command fail in a way
  // that looks like the CLI is broken. What matters is the id the file holds,
  // not how this command was told which box to delete: `box delete <id>`
  // resolves as a flag but can still be the pinned box.
  let unpinned: string | undefined;
  const pin = readOwnBoxFile();
  if (pin?.id === resolved.id) {
    try {
      unpinned = clearBoxFile();
    } catch {
      // Nothing to clear, or it could not be removed; the delete already
      // succeeded and is the thing worth reporting.
    }
  }
  // A pin in a parent directory belongs to the project, so it is not removed
  // from here; saying so beats leaving a stale pin to be discovered later.
  let stale: string | undefined;
  if (unpinned === undefined) {
    const nearest = findBoxFile(process.cwd());
    if (nearest !== undefined && resolved.id === readOwnBoxFile(path.dirname(nearest))?.id) {
      stale = nearest;
    }
  }

  emit(
    { id: resolved.id, deleted: true, unpinned: unpinned ?? null, stale_box_file: stale ?? null },
    `Deleted ${resolved.id}`,
    flags,
  );
  if (unpinned) note(`Removed ${unpinned}`);
  if (stale) note(`${stale} still points at it; run 'box use --unset' in that directory.`);
}

/**
 * Pause a box.
 *
 * Not destructive: the workspace survives and the next command resumes it.
 * @param boxId - box to pause, or undefined to use the resolved one.
 * @param flags - global flags.
 */
export async function pauseCommand(boxId: string | undefined, flags: GlobalFlags): Promise<void> {
  const resolved = resolveBoxId({ flag: boxId ?? flags.box });
  announceBox(resolved);
  const box = await Box.get(resolved.id, { apiKey: requireToken(flags.token) });
  await box.pause();
  emit(
    { id: resolved.id, status: "paused" },
    `Paused ${resolved.id}. The next command resumes it.`,
    flags,
  );
}
