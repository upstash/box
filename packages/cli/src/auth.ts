import { requireToken } from "./core/io.js";

/**
 * Resolve the API token from a flag or the environment.
 *
 * A thin alias for `requireToken`, kept because the interactive commands import
 * it by this name.
 * @param flagToken - value of --token, when given.
 * @returns the token.
 * @throws CliError when neither source supplies one.
 */
export function resolveToken(flagToken?: string): string {
  return requireToken(flagToken);
}
