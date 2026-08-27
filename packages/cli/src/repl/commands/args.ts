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
  for (const part of args.trim().split(/\s+/).filter(Boolean)) {
    if (part.startsWith("-")) flags.push(part);
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
