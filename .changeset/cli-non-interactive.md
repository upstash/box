---
"@upstash/box-cli": minor
---

Add a non-interactive command surface, so a script, a CI job or a coding agent can drive a box without a terminal.

- `box exec` runs a command and streams its output, passing the remote exit code through. `--json` collects `{stdout, stderr, exit_code}`.
- `box files` (read, write, list, stat, mkdir, rename, remove, upload, download). `box files write <path> -` takes the content from stdin.
- `box git` (clone, status, diff, commit, checkout, push, create-pr, config, exec), with `-C/--folder` for the cloned directory.
- `box expose` for public URLs, `box run` for the agent (text on stdout, tool calls on stderr), `box status`, `box use`.
- `box delete` and `box pause`. Deleting asks first and refuses without `--yes` when there is no terminal to ask, and clears a `.box` file that named the box it removed.
- `box create --no-repl` (implied by `--json` or by having no terminal) creates the box, pins it to the directory in a `.box` file and prints its id. New workspace flags: `--name`, `--size`, `--keep-alive`, `--init-command`, `--browser`, `--clone-repo`, `--no-use`.

Every command resolves its box from `--box`, then `BOX_ID`, then the nearest `.box` file. Data goes to stdout and diagnostics to stderr, so output stays pipeable. A failure of the CLI itself exits 125, following Docker and `timeout`. That is a convention rather than a guarantee: remote exit codes pass through unchanged, so a command that genuinely exits 125 looks the same by status alone. Use `--json`, where the command's `exit_code` is reported separately from whether the CLI succeeded.

Every command now reports its own failures as exit code 125 through one error boundary, rather than exiting 1 from wherever the error was noticed. The shell completion script covers the whole command surface.

Also fixes `box create` on a terminal with no flags: the agent harness was resolved before the setup wizard ran, so the wizard's own answer was rejected with "agent harness is required". `box get` now reports the box's details rather than only its id, and `/git status` in the REPL no longer reports a missing repository as a clean tree.
