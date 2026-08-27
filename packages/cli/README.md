# @upstash/box-cli

CLI for [Upstash Box](https://upstash.com/docs/box). Two ways to use it:

- **Non-interactively.** Every operation is a plain command that reads arguments, writes to stdout and sets an exit code, so a script, a CI job or a coding agent can drive a box without a terminal.
- **Interactively.** `box create` and `box connect` open a REPL for working with the box and its agent by hand.

## Installation

```bash
npm install -g @upstash/box-cli
```

Or run it from the monorepo:

```bash
pnpm build
node packages/cli/dist/cli.js --help
```

## Authentication

Set your Upstash Box API key, or pass `--token` on any command:

```bash
export UPSTASH_BOX_API_KEY=box_...
```

## Quick start

```bash
# Create a box, clone a repo into it, and pin it to this directory.
box create --no-repl --runtime node --clone-repo https://github.com/me/my-app

# Later commands need no --box: the .box file says which one.
box exec -C my-app -- npm install
box files write my-app/src/patch.ts - < patch.ts
box git status -C my-app
box git commit -C my-app -m "apply patch"
box expose 3000
```

## Choosing the box

Every command that acts on a box resolves it in this order:

1. `--box <id>` on the command
2. the `BOX_ID` environment variable
3. the nearest `.box` file, searching upward from the working directory

`box create --no-repl` writes `.box` for you. `box use <id>` writes one by hand, and `box use --unset` removes this directory's own file (it does not walk up, so unsetting from a subdirectory cannot delete the project's pin).

Which box a command chose is printed to stderr, never stdout. When `BOX_ID` wins over a `.box` file that also exists, the CLI says so, because that is the case where you are most likely to be talking to a box you did not mean.

## Output and exit codes

- Text output goes to stdout. Diagnostics, progress and the box banner go to stderr, so a pipe carries only data.
- `--json` prints the result as JSON with no envelope. It works program-wide, either spelling: `box --json status` or `box status --json`.
- The exit code of `box exec` and `box git exec` is the remote command's own exit code, so `box exec -- npm test && deploy` behaves the way it would locally.
- A failure of the CLI itself is exit code **125**, following Docker and `timeout`. This is a convention rather than a guarantee: a remote command that genuinely exits 125 is indistinguishable from a CLI failure, because the remote status is passed through unchanged. Use `--json` when you need certainty, since it reports the command's `exit_code` separately from whether the CLI succeeded.

## Commands

### `box status`

Which box is selected, where that came from, and whether it is running or paused.

```bash
box status
box status --json
```

A paused box resumes by itself on the next command, so `paused` is not an error.

### `box exec`

Run a shell command inside the box. Output streams as it arrives.

```bash
box exec -- npm test
box exec -C /workspace/home/my-app -- npm run build
box exec --json -- node -e 'console.log(1)'
```

Put the remote command after `--`. Without it, flags such as `-la` are read as flags of `box` itself.

A single argument is sent as a shell expression, exactly as written, which is how you
pipe, redirect or background something:

```bash
box exec -- '( npm run dev > dev.log 2>&1 & )'
box exec -- 'cd src && ls'
```

Several arguments are treated as argv and quoted individually, so quoting your own
shell already resolved is not lost on the way:

```bash
box exec -- node -e 'console.log("hello world")'
```

| Flag              | Description                                                      |
| ----------------- | ---------------------------------------------------------------- |
| `-C, --cwd <dir>` | Working directory inside the box                                 |
| `--json`          | Collect into `{stdout, stderr, exit_code}` rather than streaming |

Streamed output is not byte-exact: the streaming endpoint appends a trailing
newline, so `box exec -- printf abc` prints `abc` followed by a newline while
`box exec --json -- printf abc` reports `"abc"`. Use `--json` when the exact
bytes matter.

### `box files`

```bash
box files read src/index.ts
box files read logo.png --encoding base64
box files read big.log --offset 0 --length 4096
box files write src/app.ts -           # content from stdin
box files write notes.txt "some text"
box files list src
box files stat src/index.ts --follow
box files mkdir -p a/b/c
box files rename old.ts new.ts
box files remove build -r              # a directory needs -r
box files upload ./local.zip /workspace/home/local.zip
box files download my-app
```

`box files write <path> -` reads the content from stdin, which is how source code gets in without surviving shell quoting.

### `box git`

```bash
box git clone https://github.com/me/my-app
box git status -C my-app
box git diff -C my-app
box git config -C my-app --name "CI" --email ci@example.com
box git checkout -C my-app feature/x
box git exec -C my-app -- add -A
box git commit -C my-app -m "message"
box git push -C my-app
box git create-pr -C my-app --title "Fix the thing" --base main
box git exec -C my-app -- grep -n TODO
```

A clone lands in a directory named after the repository, so pass that directory with `-C, --folder`. Without it, git runs at the workspace root, which is not a repository. The CLI says so rather than reporting an empty (and apparently clean) status.

`box git exec` takes git's arguments without the leading `git`, and passes git's own exit code through. It is also the search path: `grep`, `ls-files`, `log`.

### `box expose`

Public URLs for ports inside the box.

```bash
box expose 3000
box expose 3000 --basic-auth      # credentials are printed once
box expose 3000 --bearer-token
box expose                        # same as: box expose list
box expose delete 3000
```

A server must outlive the command that started it, or its URL will not answer:

```bash
box exec -- '( npm run dev > dev.log 2>&1 & )'
box expose 3000
```

### `box run`

Run the box's agent on a prompt. The agent's text streams to stdout; its tool calls are logged to stderr, so the answer stays pipeable.

```bash
box run "Fix the failing test in src/auth.test.ts"
box run - < prompt.txt
box run "Summarise this repo" --quiet
box run "Reply with just the version" --json
```

| Flag                  | Description                               |
| --------------------- | ----------------------------------------- |
| `--timeout <seconds>` | Give up after this long                   |
| `-q, --quiet`         | Do not log tool calls                     |
| `--json`              | One object: `{output, session_id, usage}` |

The box needs an agent, which means it was created with `--agent-model` and `--agent-harness`.

### `box create`

Create a box. With a terminal and no flags it asks a few questions and opens the REPL. With `--no-repl`, `--json`, or no terminal at all, it creates the box, pins it to the current directory and exits with the id on stdout.

```bash
# Interactive
box create --agent-harness claude-code --agent-model anthropic/claude-sonnet-5

# Non-interactive: the id is the only thing on stdout
ID=$(box create --no-repl --runtime node)

# With a repository and an agent
box create --no-repl \
  --runtime node \
  --clone-repo https://github.com/me/my-app \
  --agent-harness claude-code \
  --agent-model anthropic/claude-sonnet-5 \
  --git-token $GITHUB_TOKEN \
  --env NODE_ENV=production \
  --label beta
```

| Flag                       | Description                                                                              | Default                       |
| -------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------- |
| `--runtime <runtime>`      | `node`, `python`, `golang`, `ruby`, `rust` (append `-alpine` for the smaller musl image) |                               |
| `--name <name>`            | Human-readable name                                                                      |                               |
| `--size <size>`            | Resource size                                                                            | `small`                       |
| `--keep-alive`             | Keep the box running instead of pausing when idle                                        |                               |
| `--init-command <cmd>`     | Startup script, for keep-alive boxes                                                     |                               |
| `--browser`                | Provision a headless Chromium                                                            |                               |
| `--clone-repo <repo>`      | Clone this repository after creating the box                                             |                               |
| `--agent-model <model>`    | Agent model identifier                                                                   |                               |
| `--agent-harness <name>`   | `claude-code`, `codex`, `opencode`, `cursor`                                             | required with `--agent-model` |
| `--agent-api-key [key]`    | Omit for the Upstash-managed key, `stored` for a key saved in the console, or pass a key | Upstash                       |
| `--git-token <token>`      | GitHub personal access token                                                             |                               |
| `--git-user-name <name>`   | Git `user.name` inside the box                                                           | `Upstash Box`                 |
| `--git-user-email <email>` | Git `user.email` inside the box                                                          | `box@upstash.com`             |
| `--env KEY=VAL`            | Environment variable (repeatable)                                                        |                               |
| `--label <label>`          | Label to tag the box with (repeatable)                                                   |                               |
| `--no-repl`                | Create the box, print its id and exit                                                    |                               |
| `--no-use`                 | Do not write a `.box` file for the new box                                               |                               |
| `--json`                   | Print `{id, pinned}` (implies `--no-repl`)                                               |                               |

### `box delete`, `box pause`

```bash
box delete --yes            # the pinned box
box delete box_abc123 -y
box pause
```

Deleting is irreversible, so it asks first, and refuses outright when there is no
terminal to ask unless `--yes` is given.

If this directory's own `.box` names the box being deleted, that file is removed
too, whether the box was named by id or came from the pin itself. A pin to a
deleted box makes every later command fail as though the CLI were broken. A pin in
a parent directory belongs to the project rather than to this command, so it is
left alone, the same way `box use --unset` refuses to reach upward.

Pausing loses nothing: the workspace survives and the next command resumes it.

### `box use`

Pin a box to this directory.

```bash
box use box_abc123
box use --unset
```

### `box list`, `box get`

```bash
box list
box list --label beta
box get box_abc123
box get box_abc123 --json
```

`box get` reports the box's live status, which can differ from the listing: a box pauses on its own.

### `box labels`, `box env`, `box snapshot`

```bash
box labels add box_abc123 beta
box labels remove box_abc123 beta
box labels list box_abc123

box env set KEY value
box env list
box env delete KEY

box snapshot [box-id] --name nightly
```

`box env` manages user-level variables, which are injected into boxes you create afterwards.

### `box init-demo`

Scaffold a standalone demo project that uses the `@upstash/box` SDK: a ready-to-run TypeScript script, a `.env` file and a README.

```bash
box init-demo --agent-harness claude-code --agent-model anthropic/claude-sonnet-5 --directory my-demo
```

### `box completion`

```bash
eval "$(box completion)"
```

## Interactive REPL

`box create`, `box connect` and `box from-snapshot` open a REPL:

```
Connected to box box_abc123
Type a command to run in the box, or use: /agent, /shell, /files, ...

box_abc123> npm test
box_abc123> /agent
box_abc123> Fix the failing test in auth.ts
```

Typed lines run as shell commands in the box. `/agent` switches to sending them to the agent, `/shell` switches back. Commands take a leading `/`.

| Command                                 | Description                                                    |
| --------------------------------------- | -------------------------------------------------------------- |
| `/agent`                                | Send typed lines to the agent                                  |
| `/shell`                                | Send typed lines to the shell (the default)                    |
| `/cd <path>`                            | Change the working directory used by later commands            |
| `/files read <path>`                    | Read a file                                                    |
| `/files write <path> <content>`         | Write a file                                                   |
| `/files list [path]`                    | List a directory                                               |
| `/files stat <path> [--follow]`         | Type, size, modification time and inode                        |
| `/files mkdir <path> [-p]`              | Create a directory                                             |
| `/files rename <from> <to>`             | Move or rename a path (alias `mv`)                             |
| `/files remove <path> [-r]`             | Delete a path (alias `rm`); a directory needs `-r`             |
| `/files upload <local> <dest>`          | Upload a local file into the box                               |
| `/files download [path]`                | Download files from the box                                    |
| `/git clone <repo> [branch]`            | Clone a repository                                             |
| `/git status`, `/git diff`              | Working tree state                                             |
| `/git commit <message>`                 | Commit staged changes                                          |
| `/git checkout <branch>`                | Switch branches, creating the branch when it does not exist    |
| `/git push`, `/git create-pr <title>`   | Push, open a pull request                                      |
| `/git config [--name N --email E]`      | Show or set the git identity used for commits                  |
| `/git exec <args...>`                   | Any other git command                                          |
| `/expose <port> [--basic-auth]`         | Public URL for a port in the box                               |
| `/expose list`, `/expose delete <port>` | Show or remove exposed ports                                   |
| `/status`                               | Whether the box is idle, running or paused                     |
| `/status runs`, `/status logs [n]`      | Recent runs (newest first), recent logs                        |
| `/snapshot [name]`                      | Save a snapshot of the current state                           |
| `/snapshot list`, `/snapshot delete`    | List or delete snapshots                                       |
| `/model [provider model]`               | Change the agent model                                         |
| `/pause`, `/delete`                     | Pause or delete the box, then exit                             |
| `/console`                              | Open the box in the Upstash console                            |
| `/help`, `/clear`, `/exit`              | Help, clear the screen, leave the REPL (the box keeps running) |

## Direct SSH

Boxes can also be reached over SSH, using your Box API key as the password:

```bash
ssh <box-id>@us-east-1.box.upstash.com
```

## Telemetry

The CLI sends anonymous usage telemetry with API requests via the `@upstash/box` SDK it wraps, identifying itself as `@upstash/box-cli@<version>` in the SDK telemetry chain. No user data, prompts, or identifiers are ever collected. To opt out, set `UPSTASH_DISABLE_TELEMETRY` to any value.

## License

MIT
