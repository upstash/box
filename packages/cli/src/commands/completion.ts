/** Top-level commands, and the subcommands worth completing under them. */
const COMMANDS: [name: string, description: string, subcommands: string][] = [
  ["status", "Show which box is selected and its state", ""],
  ["exec", "Run a shell command inside the box", ""],
  [
    "files",
    "File operations inside the box",
    "read write list stat mkdir rename remove upload download",
  ],
  [
    "git",
    "Git operations inside the box",
    "clone status diff commit checkout push create-pr config exec",
  ],
  ["expose", "Public URLs for ports inside the box", "list delete"],
  ["run", "Run the box's agent on a prompt", ""],
  ["use", "Pin a box to this directory", ""],
  ["delete", "Delete a box and everything in it", ""],
  ["pause", "Pause a box; the next command resumes it", ""],
  ["create", "Create a new box", ""],
  ["connect", "Connect to an existing box and enter the REPL", ""],
  ["from-snapshot", "Create a new box from a snapshot", ""],
  ["list", "List all boxes", ""],
  ["get", "Get details about a box", ""],
  ["snapshot", "Create a snapshot of a box", ""],
  ["init-demo", "Scaffold a standalone demo project", ""],
  ["env", "Manage user-level env vars", "set list delete set-all"],
  ["labels", "Manage labels on a box", "add remove list"],
  ["completion", "Output shell completion script", ""],
];

/**
 * Escape a description for a zsh single-quoted string.
 *
 * An apostrophe in a description ends the string and produces a script zsh
 * cannot parse.
 * @param value - the description.
 * @returns the description, safe to place between single quotes.
 */
function zshQuote(value: string): string {
  return value.replaceAll("'", `'\\''`);
}

/** Commands that have subcommands, as a bash case statement. */
function bashSubcommandCases(): string {
  return COMMANDS.filter(([, , subs]) => subs)
    .map(([name, , subs]) => `      ${name}) opts="${subs}" ;;`)
    .join("\n");
}

const BASH_COMPLETION = `
_box_completions() {
  local cur="\${COMP_WORDS[COMP_CWORD]}"
  local commands="${COMMANDS.map(([name]) => name).join(" ")}"

  if [ "\${COMP_CWORD}" -gt 1 ]; then
    local opts=""
    case "\${COMP_WORDS[1]}" in
${bashSubcommandCases()}
    esac
    if [ -n "$opts" ] && [ "\${COMP_CWORD}" -eq 2 ]; then
      COMPREPLY=( $(compgen -W "$opts" -- "$cur") )
      return
    fi
  fi

  COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
}
complete -F _box_completions box
`;

/** Subcommand blocks for zsh, one per command that has them. */
function zshSubcommandCases(): string {
  return COMMANDS.filter(([, , subs]) => subs)
    .map(
      ([name, , subs]) =>
        `      ${name})\n        _values '${name} subcommand' ${subs
          .split(" ")
          .map((sub) => `'${sub}'`)
          .join(" ")}\n        ;;`,
    )
    .join("\n");
}

const ZSH_COMPLETION = `
#compdef box

_box() {
  local -a commands
  commands=(
${COMMANDS.map(([name, description]) => `    '${name}:${zshQuote(description)}'`).join("\n")}
  )

  if (( CURRENT == 2 )); then
    _describe 'command' commands
    return
  fi

  case "\${words[2]}" in
${zshSubcommandCases()}
  esac
}

_box
`;

/**
 * Print a completion script for the current shell.
 *
 * Kept generated from one list so a new command cannot be added to the CLI and
 * silently missed here.
 */
export function completionCommand(): void {
  const shell = process.env.SHELL ?? "";
  if (shell.includes("zsh")) {
    console.log(ZSH_COMPLETION.trim());
  } else {
    console.log(BASH_COMPLETION.trim());
  }
}

/** The command names the completion script offers. Exported for tests. */
export const COMPLETION_COMMANDS = COMMANDS.map(([name]) => name);
