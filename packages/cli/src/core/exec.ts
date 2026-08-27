import type { Box } from "@upstash/box";

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
  // Run exposes stdout and stderr separately, which is the reason --json can
  // hand back a structured result at all rather than one interleaved blob.
  return {
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? "",
    exit_code: run.exitCode ?? 0,
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
  let exitCode = 0;
  for await (const chunk of run) {
    if (chunk.type === "output") onOutput(chunk.data);
    else if (chunk.type === "exit") exitCode = chunk.exitCode;
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
 * Quote one argument for the shell that runs it.
 * @param value - exact value to preserve.
 * @returns a single shell word.
 */
export function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
