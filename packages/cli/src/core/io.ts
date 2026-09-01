import { CliError, exitCodeFor, messageFor } from "./errors.js";

/** Flags every command shares, declared once on the program. */
export type GlobalFlags = {
  /** Box id from --box, when given. */
  box?: string;
  /** Emit machine-readable output instead of text. */
  json?: boolean;
  /** Box API token from --token, when given. */
  token?: string;
};

/**
 * Whether output is going to a terminal rather than a pipe or file.
 *
 * Decides colour, spinners, pickers and wizards — never whether output
 * streams. `box exec ls | grep x` must still stream.
 * @returns true when stdout is a TTY.
 */
export function isInteractive(): boolean {
  return Boolean(process.stdout.isTTY);
}

/**
 * Write the result of a command to stdout.
 *
 * `--json` prints the data itself, with no envelope: exit codes already say
 * whether the command succeeded, so wrapping every payload in `{ok,data}`
 * would only add a field every caller has to unwrap.
 * @param data - the value to emit under --json.
 * @param text - lines to print when not emitting JSON.
 * @param flags - the resolved global flags.
 */
export function emit(data: unknown, text: string | string[], flags: GlobalFlags): void {
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(data, undefined, 2)}\n`);
    return;
  }
  const lines = Array.isArray(text) ? text : [text];
  for (const line of lines) process.stdout.write(`${line}\n`);
}

/**
 * Write a diagnostic that is not part of the command's result.
 *
 * Banners and warnings go here so that stdout carries only data and stays
 * parseable when piped.
 * @param line - the message.
 */
export function note(line: string): void {
  process.stderr.write(`${line}\n`);
}

/**
 * Run a command body, turning a failure into a message and an exit code.
 *
 * Errors are reported on stderr and never as JSON on stdout: an agent reading
 * `box files read missing.txt` must not receive `{"error":...}` and treat it as
 * the file's contents.
 * @param run - the command body.
 */
export async function runCommand(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    note(`Error: ${messageFor(error)}`);
    process.exitCode = exitCodeFor(error);
  }
}

/**
 * Resolve the API token from the flag or the environment.
 *
 * Throws rather than exiting, so the failure is testable and so a REPL caller
 * is not killed by it.
 * @param flagToken - value of --token, when given.
 * @returns the token.
 * @throws CliError when no token is available.
 */
export function requireToken(flagToken?: string): string {
  const token = flagToken?.trim() || process.env.UPSTASH_BOX_API_KEY?.trim();
  if (!token) {
    throw new CliError("API token required. Pass --token or set UPSTASH_BOX_API_KEY.");
  }
  return token;
}
