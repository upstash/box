import type { Box } from "@upstash/box";

/**
 * Whether the box's current directory is inside a git repository.
 *
 * The status and diff endpoints discard git's exit code and stderr, so a
 * directory that is not a repository answers with empty output, which reads as
 * a clean tree. Asking git directly is the only way to tell the two apart.
 * @param box - the box, already positioned at the directory in question.
 * @returns true when it is a repository.
 * @throws whatever the probe failed with, since a probe that could not run is
 * no evidence either way.
 */
export async function isInsideRepo(box: Box): Promise<boolean> {
  const probe = await box.git.exec({ args: ["rev-parse", "--is-inside-work-tree"] });
  return probe.exit_code === 0;
}

/**
 * What to tell someone whose empty status was really a missing repository.
 * @param folder - the directory that was checked, when one was named.
 * @returns the message.
 */
export function notARepoMessage(folder?: string): string {
  const where = folder ? `"${folder}"` : "the workspace root";
  return (
    `Not a git repository: ${where}\n` +
    "A clone lands in a directory named after the repository, so pass it with -C, " +
    "e.g. box git status -C my-repo"
  );
}
