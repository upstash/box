/**
 * Exit code for a failure of the CLI itself: bad usage, missing credentials,
 * an unreachable API.
 *
 * Chosen the way Docker and `timeout` choose it: a wrapper needs a code that a
 * wrapped command is unlikely to produce, so that a remote command exiting 1
 * and the CLI failing do not look the same to `box exec cmd && next`.
 *
 * It is a convention, not a guarantee. `box exec` and `box git exec` pass the
 * remote status through unchanged, so a command that genuinely exits 125 is
 * indistinguishable from a CLI failure. Remapping it would be worse: the
 * remote status would then be a lie. A caller that needs certainty should use
 * `--json`, where the command's own `exit_code` is a separate field from
 * whether the CLI succeeded.
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
  if (typeof error === "string") return error;
  // Anything can be thrown. JSON.stringify throws on a BigInt or a circular
  // object and returns undefined for a function, and this runs inside the
  // catch that is supposed to turn any failure into a diagnostic and exit 125.
  try {
    const text = JSON.stringify(error);
    if (text !== undefined) return text;
  } catch {
    // Fall through to the plain description below.
  }
  return String(error);
}
