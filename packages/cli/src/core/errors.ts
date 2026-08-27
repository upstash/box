/**
 * Exit code for a failure of the CLI itself: bad usage, missing credentials,
 * an unreachable API.
 *
 * Chosen the way Docker and `timeout` choose it — a wrapper needs a code that
 * cannot be confused with one the wrapped command produced. A remote command
 * exiting 1 and the CLI failing must not look the same to `box exec cmd && next`.
 */
export const CLI_FAILURE_EXIT_CODE = 125;

/**
 * An error the CLI is expected to produce, carrying the exit code to use.
 *
 * Cores throw this instead of calling process.exit, so the same code path can
 * be unit tested and so a caller inside the REPL is not killed by a failure
 * that should only end one command.
 */
export class CliError extends Error {
  /** Code to exit with; defaults to the CLI-failure code. */
  readonly exitCode: number;

  constructor(message: string, options?: { exitCode?: number; cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "CliError";
    this.exitCode = options?.exitCode ?? CLI_FAILURE_EXIT_CODE;
  }
}

/**
 * Exit code carried by an error, for a remote command that failed on its own.
 *
 * A command's status passes through unchanged; anything else is a CLI failure.
 * @param error - the thrown value.
 * @returns the exit code to use.
 */
export function exitCodeFor(error: unknown): number {
  return error instanceof CliError ? error.exitCode : CLI_FAILURE_EXIT_CODE;
}

/**
 * Human-readable text for a thrown value.
 * @param error - the thrown value.
 * @returns its message, or a printable form of a non-Error.
 */
export function messageFor(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : JSON.stringify(error);
}
