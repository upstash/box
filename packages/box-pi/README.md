# Upstash Box Extension for Pi

This is a [Pi](https://pi.dev) extension that runs every Pi tool call inside an [Upstash Box](https://upstash.com) sandbox. The agent runs on your machine, while `bash`, file I/O, and search execute in a remote box that is created when you launch Pi with `--box`, kept with your session (and reattached when you resume it), and deleted when you delete that session.

> [!NOTE]
> This is the **inverse** of running Pi *inside* a box (the Box SDK's custom-harness example): here the agent and your API keys stay local, and only tool execution is remote.

## Features

- Runs Pi's tool calls in an isolated Upstash Box while the agent stays on your machine
- Clones the repo you're in (or a `--repo` you pass) into the box automatically
- Syncs each session to its own GitHub branch — the agent commits, the extension pushes
- Keeps one box per session and reattaches it when you resume
- Generates live preview links when a server starts in the box
- `/pr` creates a real pull request via the Box git API

## Usage

### Installation

First, install Pi:

```bash
npm install -g @earendil-works/pi-coding-agent
```

See [pi.dev](https://pi.dev) for other install options.

Then add the Upstash Box extension to Pi:

```bash
pi install npm:@upstash/box-pi
```

> [!NOTE]
> To update the extension later, run `pi update` — `pi install` won't refresh an existing install.

### Environment Configuration

This extension requires an Upstash account and API key to create boxes.

Set your Upstash Box API key as an environment variable (e.g. in your shell profile):

```bash
export UPSTASH_BOX_API_KEY="your-api-key"
```

The extension also respects `UPSTASH_BOX_BASE_URL` (advanced; defaults to the public Box endpoint).

If no key is set and a UI is available, Pi prompts you for one once per session.

### Running Pi

Run Pi from inside a git repository:

```bash
cd my-project
pi --box
```

The extension clones the repo you're in into the box and syncs your work to a GitHub branch (see [GitHub branch sync](#github-branch-sync)).

Or point at a different repository:

```bash
pi --box --repo github.com/acme/api --branch dev
```

Or run outside a git repo to get a blank workspace.

#### Flags

| Flag               | Description                                                          |
| ------------------ | -------------------------------------------------------------------- |
| `--box`            | Run tools inside an Upstash Box sandbox                              |
| `--repo <url>`     | Git repo to clone into the box (defaults to the repo you're in)      |
| `--branch <name>`  | Branch to clone (defaults to your current branch)                    |
| `--runtime <name>` | Box runtime image: `node`, `python`, `golang`, `ruby`, `rust` (append `-alpine` for the musl variant) |
| `--size <name>`    | Box size: `small` (default), `medium`, or `large`                    |

#### Slash commands

While Pi is running with `--box`, you can manage the active box:

- `/sandbox` — show the active box's status: state, working directory, branch, sync status, and its GitHub branch link
- `/github` — open this session's branch on GitHub
- `/compare` — open this session's branch compare view on GitHub
- `/merge` — merge this session's branch into its base on GitHub
- `/pr` — create a pull request for this session's branch (falls back to GitHub's compare page)

## How It Works

The agent runs on your machine. Pi's tool layer is pluggable, so this extension substitutes Box-backed implementations of `bash`, `read`, `write`, `edit`, and `ls`, plus dedicated in-box tools for `find` and `grep`. A footer badge is the always-visible signal that work is remote.

### Lifecycle

- **One box per session, kept across runs.** A session's box is recorded and **reattached** when you resume the session — your work and environment persist.
- **Idle pauses** the box automatically (its filesystem is preserved); the Box coordinator transparently restarts it on the next tool call. There is nothing to configure.
- **Deleted when the session is.** When you delete a session from Pi's resume menu, its box is reaped on the next Pi launch/exit (Pi has no session-deleted hook, so the extension reconciles live sessions against its boxes). There is no auto-delete timer — a box lives until its session is gone.
- **In-memory sessions** (`--blank` / no session) can't be resumed, so their box is deleted on exit.

### GitHub branch sync

If you're in a **github.com** repo and logged in via the GitHub CLI (`gh auth login`), each session gets its own branch and the agent's commits are pushed there automatically. The repo comes from `--repo`, or — when you omit it — is **detected from the git project you launched Pi in** (its `origin` and current branch).

- On start, the extension creates `pi/<short-session-id>` on GitHub (off your current branch, or `--branch`) and clones it into the box over HTTPS. The clone seeds the box's git credential store.
- The agent **commits its own work** — it's prompted to commit after making changes, and not to push. After each turn the extension pushes those commits to the branch via the Box git API. Before every push the credential store is re-seeded with a freshly minted `gh` token, so pushes are immune to token expiry. A branch with nothing new is skipped.
- `/merge` merges the branch into its base, and `/pr` creates a pull request.
- **Forks** start a fresh box and branch off the parent session's branch.

All network git operations (clone/push) run **inside the box** through the Box git API; the host only uses `gh` to mint a token and call the GitHub API. A git identity is configured in the box so commits work out of the box.

> [!NOTE]
> When you're not in a github.com repo (or `gh` isn't authenticated), push is disabled. The box still gets a local git repo so the agent can commit, but nothing is pushed.

### Tools

| Tool                | What it does                                                                        |
| ------------------- | ----------------------------------------------------------------------------------- |
| `bash` (+ user `!`) | Run a command in the box (streaming exec); backgrounded processes (`&`) don't hang  |
| `read`              | Read a file from the box (binary-safe via base64)                                   |
| `write`             | Write a file to the box                                                             |
| `edit`              | Edit a file (download → modify → upload; preserves Pi's exact-match semantics)      |
| `ls`                | List a box directory                                                                |
| `find`              | Find files by glob inside the box (gitignore-aware, supports path globs)            |
| `grep`              | Search file contents inside the box                                                 |
| `preview_url(port)` | Get a preview URL for a port, protected with basic auth (the browser prompts for the printed login) — created fresh on every call (URLs don't survive a pause) |

## Development

This package lives in the [`upstash/box`](https://github.com/upstash/box) monorepo under `packages/box-pi`.

### Setup

```bash
git clone https://github.com/upstash/box
cd box
pnpm install
cd packages/box-pi
```

### Development and Testing

To modify the extension, edit the source files in this package.

> [!NOTE]
> Because Pi loads extensions as TypeScript via [jiti](https://github.com/unjs/jiti), there is no build step — Pi runs the source directly.

#### Run from source

Remove any previously installed copy (loading two copies makes every tool and flag conflict):

```bash
pi list                        # shows installed packages and their exact source
pi uninstall <source>          # e.g. npm:@upstash/box-pi — use the source shown by `pi list`
```

Install the local directory:

```bash
pi install .    # add --local to scope it to the current project instead of globally
```

Run Pi:

```bash
UPSTASH_BOX_API_KEY=... pi --box
```

Edits to the source take effect on the next run — no reinstall needed.

Alternatively, load the source for a single run without installing:

```bash
UPSTASH_BOX_API_KEY=... pi -e ./index.ts --box
```

#### Tests

```bash
npm run typecheck                 # type-check (tsc --noEmit)
npm test                          # offline unit tests (mocked Box; no API key/network)
npm run smoke                     # offline: load the extension and check it registers
npm run check                     # all of the above
npm run test:live                 # end-to-end against real Upstash Box (needs UPSTASH_BOX_API_KEY)
```

The live suite covers the ops layer against a real box (`test:basic`), backgrounded processes + timeouts (`test:bash-bg`), and pause/delete recovery semantics (`test:recovery`).

## Project Structure

```
packages/box-pi/
├── index.ts            # Extension entry point: flags, lifecycle, commands
├── src/                # Box-backed tool implementations
│   ├── tools.ts        # Tool registration (box-backed tools + preview_url)
│   ├── auth.ts         # Upstash Box API key resolution
│   ├── box.ts          # Box resilience layer (recovery, cwd/timeout wrappers, streaming exec)
│   ├── ops.ts          # Box-backed bash/read/write/edit/ls operations
│   ├── find-tool.ts    # In-box find (ripgrep/find)
│   ├── grep-tool.ts    # In-box grep (ripgrep/grep)
│   ├── github.ts       # Host gh control-plane (token + GitHub API)
│   ├── sync.ts         # Box-side git push + credential refresh (Box git API)
│   └── util.ts         # Small shared helpers
├── test/               # Offline unit tests (mocked Box)
├── scripts/            # Offline smoke + live integration tests
├── package.json        # Package metadata (includes the "pi" extensions field)
├── tsconfig.json       # TypeScript config
└── README.md
```

## License

MIT
