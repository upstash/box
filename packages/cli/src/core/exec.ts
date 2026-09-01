import type { Box } from "@upstash/box";
import { CliError } from "./errors.js";

/** Result of running one command in a box. */
export type ExecResult = {
  stdout: string;
  stderr: string;
  exit_code: number;
};

/**
 * Run a command and collect its output.
 *
 * Used for `--json`, where a caller wants one parseable object rather than an
 * interleaved stream it would have to reassemble.
 * @param box - the box to run in.
 * @param command - the shell command.
 * @param options - working directory inside the box.
 * @returns stdout, stderr and the command's exit code.
 */
export async function execCollect(
  box: Box,
  command: string,
  options?: { cwd?: string | undefined },
): Promise<ExecResult> {
  const run = await box.exec.command(withCwd(command, options?.cwd));
  if (run.exitCode === null || run.exitCode === undefined) {
    // Reporting 0 here would let chained work proceed on a response that never
    // said the command succeeded, which is what the streaming path refuses.
    throw new CliError("The command finished without reporting an exit status");
  }
  // Run exposes stdout and stderr separately, which is the reason --json can
  // hand back a structured result at all rather than one interleaved blob.
  return {
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? "",
    exit_code: run.exitCode,
  };
}

/**
 * Run a command, handing output to a sink as it arrives.
 *
 * Streaming is the default for a terminal because a long build that prints
 * nothing until it finishes is indistinguishable from one that has hung.
 * @param box - the box to run in.
 * @param command - the shell command.
 * @param onOutput - receives each chunk as it arrives.
 * @param options - working directory inside the box.
 * @returns the command's exit code.
 */
export async function execStream(
  box: Box,
  command: string,
  onOutput: (chunk: string) => void,
  options?: { cwd?: string | undefined },
): Promise<number> {
  const run = await box.exec.stream(withCwd(command, options?.cwd));
  let exitCode: number | undefined;
  for await (const chunk of run) {
    if (chunk.type === "output") onOutput(chunk.data);
    else if (chunk.type === "exit") exitCode = chunk.exitCode;
  }
  if (exitCode === undefined) {
    // Defaulting to 0 would let `box exec ... && next` run next on a stream
    // that was cut off before the remote status arrived.
    throw new CliError("The command's output ended before its exit status arrived");
  }
  return exitCode;
}

/**
 * Apply a working directory to a command.
 *
 * The SDK sends `sh -c <command>`, so a directory is expressed in the command
 * itself. `cd` failing must stop the command rather than silently running it
 * somewhere else, hence `&&`.
 * @param command - the caller's command.
 * @param cwd - directory inside the box, when given.
 * @returns the command to send.
 */
export function withCwd(command: string, cwd?: string): string {
  if (cwd === undefined || cwd.trim() === "") return command;
  return `cd ${quoteShellArg(cwd)} && ${command}`;
}

/**
 * Build the shell command line from the argv the local shell handed over.
 *
 * The SDK sends one string to `sh -c`, so argv has to be turned back into a
 * command line. Joining with spaces loses the boundaries the local shell
 * already resolved: `-e 'console.log("a b")'` becomes three words again and
 * the remote shell splits it differently.
 *
 * A single argument is passed through untouched, because that is how a shell
 * expression is written: `box exec -- '( npm run dev & )'` has to keep its
 * parentheses and ampersand. Two or more arguments are argv, so each is quoted
 * and the boundaries survive.
 * @param parts - the remote command as the local shell split it.
 * @returns the command line to send.
 */
export function buildCommand(parts: string[]): string {
  if (parts.length === 0) return "";
  // A lone argument is the shell expression form, and a lone empty one is just
  // no command at all.
  if (parts.length === 1) return parts[0]!.trim();
  // Empty arguments are kept: `printf '<%s>' ''` means to pass one.
  return parts.map(quoteShellArg).join(" ");
}

/**
 * Quote one argument for the shell that runs it.
 * @param value - exact value to preserve.
 * @returns a single shell word.
 */
export function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
