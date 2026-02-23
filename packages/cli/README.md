# @upstash/box-cli

REPL-first CLI for [Upstash Box](https://upstash.com/docs/box) — create and interact with sandboxed AI coding agents from the terminal.

## Installation

```bash
npm install -g @upstash/box-cli
```

Or run directly from the monorepo:

```bash
pnpm build
node packages/cli/dist/index.js --help
```

## Authentication

Provide your Upstash Box API token via the `--token` flag or the `UPSTASH_BOX_API_KEY` environment variable:

```bash
export UPSTASH_BOX_API_KEY=abx_...
```

## Commands

### `box create`

Create a new box and enter an interactive REPL.

```bash
box create \
  --agent-model claude/sonnet_4_5 \
  --agent-api-key $CLAUDE_KEY \
  --runtime node \
  --git-token $GITHUB_TOKEN \
  --env NODE_ENV=production \
  --env DEBUG=true
```

| Flag              | Description                                                              |
| ----------------- | ------------------------------------------------------------------------ |
| `--token`         | Upstash Box API token                                                    |
| `--runtime`       | Runtime environment (`node`, `python`, `golang`, `ruby`, `rust`)         |
| `--agent-model`   | Agent model identifier                                                   |
| `--agent-api-key` | Agent API key — Anthropic or OpenAI (required if `--agent-model` is set) |
| `--git-token`     | GitHub personal access token                                             |
| `--env KEY=VAL`   | Environment variable (repeatable)                                        |

### `box connect [box-id]`

Connect to an existing box and enter the REPL. If no box ID is given, connects to the most recent box.

```bash
box connect box_abc123
box connect  # connects to most recent
```

### `box from-snapshot <snapshot-id>`

Create a new box from a snapshot and enter the REPL. Accepts the same flags as `create`.

```bash
box from-snapshot snap_abc123 \
  --agent-model claude/sonnet_4_5 \
  --agent-api-key $CLAUDE_KEY
```

### `box list`

List all boxes.

```bash
box list
```

### `box get <box-id>`

Print box details as JSON.

```bash
box get box_abc123
```

### `box init-demo`

Scaffold a standalone demo project that uses the `@upstash/box` SDK. Creates a directory with a ready-to-run TypeScript script, `.env` file, and README.

```bash
box init-demo \
  --token $UPSTASH_BOX_API_KEY \
  --agent-model claude/sonnet_4_5 \
  --agent-api-key $CLAUDE_KEY \
  --runtime node \
  --git-token $GITHUB_TOKEN \
  --directory my-demo
```

| Flag              | Description                                                              | Default    |
| ----------------- | ------------------------------------------------------------------------ | ---------- |
| `--token`         | Upstash Box API token                                                    |            |
| `--agent-model`   | Agent model identifier                                                   |            |
| `--agent-api-key` | Agent API key (required if `--agent-model` is set)                       |            |
| `--runtime`       | Runtime environment                                                      | `node`     |
| `--git-token`     | GitHub personal access token                                             |            |
| `--directory`     | Output directory                                                         | `box-demo` |

After scaffolding, the command offers to run the demo immediately. The generated project includes:

- `main.ts` — demo script that creates a box, writes/reads files, executes commands, and cleans up
- `.env` — pre-filled environment variables
- `README.md` — usage documentation

## Interactive REPL

After `create`, `connect`, or `from-snapshot`, you enter an interactive REPL session:

```
Connected to box box_abc123
Type a prompt to run the agent, or use commands: run, exec, files, git, snapshot, pause, delete, exit

box_abc123> Fix the bug in auth.ts
```

### REPL commands

Any text entered is sent to the agent by default. You can also use explicit commands (with or without a `/` prefix):

| Command                        | Description                                    |
| ------------------------------ | ---------------------------------------------- |
| `run <prompt>`                 | Run the agent with a prompt (streaming output) |
| `exec <command>`               | Execute a shell command in the box             |
| `files read <path>`            | Read a file                                    |
| `files write <path> <content>` | Write a file                                   |
| `files list [path]`            | List files in a directory                      |
| `files upload <local> <dest>`  | Upload a local file                            |
| `files download [path]`        | Download files from the box                    |
| `git clone <repo> [branch]`    | Clone a repository                             |
| `git diff`                     | Show git diff                                  |
| `git create-pr <title>`        | Create a pull request                          |
| `snapshot [name]`              | Save a snapshot of the current state           |
| `pause`                        | Pause the box and exit                         |
| `delete`                       | Delete the box and exit                        |
| `exit`                         | Exit the REPL (box keeps running)              |

### Examples

```
box_abc123> Add error handling to the payment service
box_abc123> exec npm test
box_abc123> files list src/
box_abc123> git diff
box_abc123> snapshot before-refactor
box_abc123> exit
```

## License

MIT
