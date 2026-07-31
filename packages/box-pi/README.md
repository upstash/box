# Upstash Box Extension for Pi

A [Pi](https://pi.dev) extension that runs the agent's tool calls — `bash`, file I/O, search — inside an [Upstash Box](https://upstash.com) sandbox. The agent and your API keys stay on your machine; only tool execution is remote.

## Install

```bash
npm install -g @earendil-works/pi-coding-agent   # install Pi
pi install npm:@upstash/box-pi                   # add the extension
export UPSTASH_BOX_API_KEY="..."                 # your Upstash Box API key
```

To update the extension later, run `pi update`.

## Usage

Run Pi from inside a git repository:

```bash
cd my-project
pi --box
```

The repo you're in is cloned into a fresh box, and each session gets its own GitHub branch. You can also point at another repo, or run outside a git repo for a blank workspace:

```bash
pi --box --repo github.com/acme/api --branch dev
```

### Flags

| Flag               | Description                                                          |
| ------------------ | -------------------------------------------------------------------- |
| `--box`            | Run tools inside an Upstash Box sandbox                              |
| `--repo <url>`     | Git repo to clone into the box (defaults to the repo you're in)      |
| `--branch <name>`  | Branch to clone (defaults to your current branch)                    |
| `--runtime <name>` | Box runtime image: `node`, `python`, `golang`, `ruby`, `rust` (append `-alpine` for the musl variant) |
| `--size <name>`    | Box size: `small` (default), `medium`, or `large`                    |

### Slash commands

- `/sandbox` — show the active box's status
- `/github` — open this session's branch on GitHub
- `/compare` — open the branch compare view on GitHub
- `/merge` — merge this session's branch into its base
- `/pr` — create a pull request for this session's branch

## How it works

- **One box per session.** Created on launch, reattached when you resume the session, deleted when you delete the session. Idle boxes pause automatically (filesystem preserved) and restart on the next tool call.
- **Box-backed tools.** `bash`, `read`, `write`, `edit`, `ls`, `find`, and `grep` execute in the box. `preview_url(port)` returns a live, basic-auth-protected URL for a server running in the box. A footer badge shows that work is remote.
- **GitHub branch sync.** In a github.com repo with the GitHub CLI logged in (`gh auth login`), each session gets a `pi/<short-session-id>` branch — the agent commits its work, the extension pushes after each turn. `/pr` and `/merge` act on that branch. Outside GitHub (or without `gh`), the box still has a local git repo, but nothing is pushed.

## Development

This package lives in the [`upstash/box`](https://github.com/upstash/box) monorepo under `packages/box-pi`. Pi loads extensions as TypeScript directly (via [jiti](https://github.com/unjs/jiti)), so there is no build step.

Run from source — first remove any installed copy (loading two copies makes every tool and flag conflict), then install the local directory:

```bash
pi uninstall npm:@upstash/box-pi   # use the source shown by `pi list`
pi install .                       # edits take effect on the next run
UPSTASH_BOX_API_KEY=... pi --box
```

Tests:

```bash
npm run check       # offline: typecheck + unit tests + smoke
npm run test:live   # end-to-end against real boxes (needs UPSTASH_BOX_API_KEY)
```

## License

MIT
