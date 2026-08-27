import { Box } from "@upstash/box";
import { announceBox, resolveBoxId } from "../core/box-ref.js";
import { CliError } from "../core/errors.js";
import { isInsideRepo, notARepoMessage } from "../core/git-repo.js";
import { emit, requireToken, type GlobalFlags } from "../core/io.js";

export type GitFlags = GlobalFlags & {
  folder?: string;
  branch?: string;
  depth?: string;
  githubToken?: string;
  message?: string;
  authorName?: string;
  authorEmail?: string;
  title?: string;
  body?: string;
  base?: string;
  name?: string;
  email?: string;
};

/**
 * Resolve the box, without touching its working directory.
 * @param flags - global flags.
 * @returns the box.
 */
async function openBox(flags: GitFlags): Promise<Box> {
  const resolved = resolveBoxId({ flag: flags.box });
  announceBox(resolved);
  return Box.get(resolved.id, { apiKey: requireToken(flags.token) });
}

/**
 * Resolve the box and move it to the repository directory.
 *
 * The SDK reads the repository directory from its own working directory rather
 * than from each call, so --folder is applied here once. A clone lands in a
 * subdirectory named after the repo, so without this every git call would run
 * against the workspace root, which is not a repository.
 * @param flags - global flags plus --folder.
 * @returns the box, positioned.
 */
async function open(flags: GitFlags): Promise<Box> {
  const box = await openBox(flags);
  if (flags.folder !== undefined && flags.folder !== "") await box.cd(flags.folder);
  return box;
}

/**
 * Fail loudly when a directory is not a git repository.
 *
 * Only worth a round trip when the output was empty, which is the one case
 * where a missing repository and a clean tree look the same.
 * @param box - the box, already positioned at --folder.
 * @param flags - used to name the directory in the message.
 */
async function assertRepo(box: Box, flags: GitFlags): Promise<void> {
  let inside;
  try {
    inside = await isInsideRepo(box);
  } catch (error) {
    // A probe that could not run says nothing about the directory, and
    // reporting the empty output as a clean tree would be a guess.
    const where = flags.folder ? `"${flags.folder}"` : "the workspace root";
    throw new CliError(`Could not check whether ${where} is a git repository`, { cause: error });
  }
  if (!inside) throw new CliError(notARepoMessage(flags.folder));
}

/**
 * Clone a repository into the box.
 *
 * Clone is the one verb where --folder names the destination rather than an
 * existing directory, so it is sent as an option instead of being applied with
 * cd, which would fail on the directory the clone is about to create.
 */
export async function gitCloneCommand(repo: string, flags: GitFlags): Promise<void> {
  const box = await openBox(flags);
  const depth = flags.depth === undefined ? undefined : Number(flags.depth);
  if (depth !== undefined && (!Number.isInteger(depth) || depth < 1)) {
    throw new CliError("--depth must be a positive whole number");
  }
  await box.git.clone({
    repo,
    ...(flags.branch === undefined ? {} : { branch: flags.branch }),
    ...(depth === undefined ? {} : { depth }),
    ...(flags.githubToken === undefined ? {} : { githubToken: flags.githubToken }),
    ...(flags.folder === undefined || flags.folder === "" ? {} : { folder: flags.folder }),
  });
  emit({ repo, folder: flags.folder ?? null }, `Cloned ${repo}`, flags);
}

/** Working-tree status. */
export async function gitStatusCommand(flags: GitFlags): Promise<void> {
  const box = await open(flags);
  const status = await box.git.status();
  if (!status) await assertRepo(box, flags);
  emit(status, typeof status === "string" ? status : JSON.stringify(status, undefined, 2), flags);
}

/** Working-tree diff. */
export async function gitDiffCommand(flags: GitFlags): Promise<void> {
  const box = await open(flags);
  const diff = await box.git.diff();
  if (!diff) await assertRepo(box, flags);
  emit(diff, typeof diff === "string" ? diff : JSON.stringify(diff, undefined, 2), flags);
}

/** Commit staged changes. */
export async function gitCommitCommand(flags: GitFlags): Promise<void> {
  if (!flags.message) throw new CliError("Usage: box git commit -m <message>");
  const box = await open(flags);
  const commit = await box.git.commit({
    message: flags.message,
    ...(flags.authorName === undefined ? {} : { authorName: flags.authorName }),
    ...(flags.authorEmail === undefined ? {} : { authorEmail: flags.authorEmail }),
  });
  emit(commit, `Committed ${commit.sha ?? ""}`.trim(), flags);
}

/** Switch to a branch, creating it when it does not exist. */
export async function gitCheckoutCommand(branch: string, flags: GitFlags): Promise<void> {
  const box = await open(flags);
  await box.git.checkout({ branch });
  // The server falls back to creating the branch with stderr suppressed, so a
  // real failure (dirty tree, bad ref) also arrives here as "created".
  emit({ branch }, `Checked out ${branch} (created if it did not exist)`, flags);
}

/** Push the current branch. */
export async function gitPushCommand(flags: GitFlags): Promise<void> {
  const box = await open(flags);
  await box.git.push(flags.branch === undefined ? undefined : { branch: flags.branch });
  emit({ pushed: true }, "Pushed.", flags);
}

/** Open a pull request. */
export async function gitCreatePrCommand(flags: GitFlags): Promise<void> {
  if (!flags.title) throw new CliError("Usage: box git create-pr --title <title>");
  const box = await open(flags);
  const pr = await box.git.createPR({
    title: flags.title,
    ...(flags.body === undefined ? {} : { body: flags.body }),
    ...(flags.base === undefined ? {} : { base: flags.base }),
  });
  emit(pr, pr.url ? `Pull request: ${pr.url}` : "Pull request created", flags);
}

/**
 * Show or set the git identity used for commits.
 *
 * There is no endpoint that reads it back, and `status` returns porcelain
 * rather than config, so the read asks git itself.
 */
export async function gitConfigCommand(flags: GitFlags): Promise<void> {
  const box = await open(flags);
  if (flags.name === undefined && flags.email === undefined) {
    const [name, email] = await Promise.all([
      box.git.exec({ args: ["config", "--get", "user.name"] }).catch(() => undefined),
      box.git.exec({ args: ["config", "--get", "user.email"] }).catch(() => undefined),
    ]);
    const shown = (result: { output?: string } | undefined) => result?.output?.trim() || "(unset)";
    emit(
      { git_user_name: shown(name), git_user_email: shown(email) },
      `git identity: ${shown(name)} <${shown(email)}>`,
      flags,
    );
    return;
  }
  const updated = await box.git.updateConfig({
    ...(flags.name === undefined ? {} : { userName: flags.name }),
    ...(flags.email === undefined ? {} : { userEmail: flags.email }),
  });
  emit(updated, `git identity: ${updated.git_user_name} <${updated.git_user_email}>`, flags);
}

/** Run any other git command; also the search path (grep, ls-files). */
export async function gitExecCommand(args: string[], flags: GitFlags): Promise<void> {
  if (args.length === 0) {
    throw new CliError("Usage: box git exec -- <args...>   e.g. box git exec -- grep -n TODO");
  }
  if (args[0] === "git") {
    throw new CliError(
      'Drop the leading "git": the server adds it (use "status", not "git status")',
    );
  }
  const box = await open(flags);
  const result = await box.git.exec({ args });
  emit(result, result.output.trim(), flags);
  // git's own status, so `box git exec -- diff --quiet` chains like it would
  // locally. 128 here usually means -C pointed somewhere that is not a repo.
  if (result.exit_code !== 0) process.exitCode = result.exit_code;
}
