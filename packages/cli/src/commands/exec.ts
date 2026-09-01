import { Box } from "@upstash/box";
import { announceBox, resolveBoxId } from "../core/box-ref.js";
import { CliError } from "../core/errors.js";
import { buildCommand, execCollect, execStream } from "../core/exec.js";
import { emit, requireToken, type GlobalFlags } from "../core/io.js";

export type ExecFlags = GlobalFlags & { cwd?: string };

/**
 * Run a shell command inside a box.
 *
 * Output streams by default and is collected under `--json`. The command's own
 * exit code is what this process exits with, so `box exec ... && next` behaves
 * the way it would locally; a failure of the CLI itself uses 125 instead, which
 * cannot be confused with a status the command produced.
 * A single argument is treated as a shell expression and passed through as
 * written; several are treated as argv and quoted, so quoting the local shell
 * already resolved is not lost on the way.
 * @param parts - the remote command, already split by the shell.
 * @param flags - global flags plus --cwd.
 */
export async function execCommand(parts: string[], flags: ExecFlags): Promise<void> {
  const command = buildCommand(parts);
  if (!command) {
    throw new CliError(
      "Usage: box exec [--cwd <dir>] -- <command>\n" +
        "Pass -- before a command that contains flags, e.g. box exec -- ls -la",
    );
  }

  const resolved = resolveBoxId({ flag: flags.box });
  announceBox(resolved);
  const box = await Box.get(resolved.id, { apiKey: requireToken(flags.token) });

  if (flags.json) {
    const result = await execCollect(box, command, { cwd: flags.cwd });
    emit(result, "", flags);
    // The object is the answer, so it is printed either way; the exit code
    // still carries the command's status for a caller that chains on it.
    if (result.exit_code !== 0) {
      process.exitCode = result.exit_code;
    }
    return;
  }

  const exitCode = await execStream(
    box,
    command,
    (chunk) => {
      process.stdout.write(chunk);
    },
    { cwd: flags.cwd },
  );
  if (exitCode !== 0) process.exitCode = exitCode;
}
