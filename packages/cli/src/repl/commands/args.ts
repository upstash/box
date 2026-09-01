/**
 * Argument splitting for REPL subcommands.
 *
 * Flags and positionals are separated before either is read, so a flag may
 * appear anywhere. Taking the path from a fixed index instead means the Unix
 * spelling — `rm -r dir` — silently treats the flag as the path.
 */
export type SplitArgs = {
  /** Arguments that are not flags, in order. */
  positionals: string[];
  /** Flags exactly as written, including their dashes. */
  flags: string[];
};

/**
 * Split whitespace-separated arguments into positionals and flags.
 * @param args - raw argument string following the subcommand.
 * @returns the positionals and flags, each in the order given.
 */
export function splitArgs(args: string): SplitArgs {
  const positionals: string[] = [];
  const flags: string[] = [];
  let literal = false;
  for (const part of args.trim().split(/\s+/).filter(Boolean)) {
    // Everything after `--` is a positional, which is the only way to name a
    // path that begins with a dash: without it, `files read -notes` loses its
    // argument to the flag list and the verb sees no path at all.
    if (!literal && part === "--") {
      literal = true;
      continue;
    }
    if (!literal && part.startsWith("-")) flags.push(part);
    else positionals.push(part);
  }
  return { positionals, flags };
}

/**
 * Whether any of the given spellings was passed.
 * @param flags - flags from {@link splitArgs}.
 * @param names - accepted spellings, e.g. `["--recursive", "-r"]`.
 * @returns true when one of them is present.
 */
export function hasFlag(flags: string[], names: string[]): boolean {
  return flags.some((flag) => names.includes(flag));
}

/**
 * Read the value that follows a `--flag value` pair.
 * @param args - raw argument string.
 * @param flag - flag to look for, including dashes.
 * @returns the following token, or undefined when the flag is absent or last.
 */
export function readFlagValue(args: string, flag: string): string | undefined {
  const parts = args.trim().split(/\s+/).filter(Boolean);
  const index = parts.indexOf(flag);
  if (index === -1) return undefined;
  const value = parts[index + 1];
  return value === undefined || value.startsWith("-") ? undefined : value;
}

/**
 * Whether a flag token appears at all, regardless of its value.
 *
 * `readFlagValue` cannot tell a missing flag from one given without a value,
 * and those mean different things: the first is "show me", the second is a
 * mistake worth reporting.
 * @param args - the raw argument string.
 * @param flag - the flag to look for.
 * @returns true when the token is present.
 */
export function hasFlagToken(args: string, flag: string): boolean {
  return args.trim().split(/\s+/).filter(Boolean).includes(flag);
}
