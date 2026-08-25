# @upstash/dsh-box

Run [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) shell work inside a remote [Upstash Box](https://upstash.com/docs/box).

The harness keeps running locally: your agent, model calls, session state, and tools stay on your machine. Only the process world moves. Bash, and anything else built on the subprocess seam, executes in the box.

## Install

```bash
dsh plugin --profile <name> add @upstash/dsh-box
```

That installs the package and appends its bundle, which mounts two plugins:

| Plugin                        | `ctx` key        | Role                                                                        |
| ----------------------------- | ---------------- | --------------------------------------------------------------------------- |
| `@upstash/dsh-box`            | `ctx.box`        | Creates one box, prepares its working directory, and deletes it on disposal |
| `@upstash/dsh-box/subprocess` | `ctx.subprocess` | Implements the subprocess seam over Box live exec sessions                  |

Set `UPSTASH_BOX_API_KEY` in your environment, or pass `apiKey` in the profile.

Nothing above the seam is forked. `dsh-bash-local` delegates every execution-world operation to `ctx.subprocess`, so mounting the adapter is the whole integration.

## Configure

The bundle's defaults work as-is. To override, edit the rows in your profile:

```yaml
- id: box
  name: "@upstash/dsh-box"
  config:
    cwd: /workspace/home
    runtime: node

- id: subprocess
  name: "@upstash/dsh-box/subprocess"
```

| Key                | Default                                      | Meaning                                                 |
| ------------------ | -------------------------------------------- | ------------------------------------------------------- |
| `apiKey`           | `UPSTASH_BOX_API_KEY`                        | Account credential. It is never forwarded into the box. |
| `baseUrl`          | `UPSTASH_BOX_BASE_URL`, then the SDK default | API endpoint.                                           |
| `cwd`              | `/workspace/home`                            | Shared remote working directory.                        |
| `runtime`          | `node`                                       | Box base image.                                         |
| `requestTimeoutMs` | `600000`                                     | Per-request HTTP timeout. Not a box lifetime.           |

If you also set a sandbox policy, point its `workspaceRoot` at the same `cwd`, since that is bash's default working directory too.

## How it behaves

- **One box per profile.** The owner creates it at load and deletes it at disposal, so a box does not outlive the fiber that owns it.
- **The environment does not leak.** Only the environment entries a spawn explicitly asks for cross into the box. Your machine's `PATH`, `HOME`, `USER`, `SSH_AUTH_SOCK`, and CI variables stay on your machine.
- **Termination is tree-scoped.** Stopping a command sends SIGTERM to the whole process tree, then SIGKILL after the grace period, so background children cannot outlive the command that started them.
- **The session owns the process.** Losing the connection stops the command rather than orphaning it in the box.

## Requirements

DeepSeek Harness supplies `@deepseek-ai/cordis`, `@deepseek-ai/dsh-subprocess`, and `@deepseek-ai/dsh-timeout` as peer dependencies. A dsh profile already has them.

## Limitations

- **No filesystem adapter.** Only the process world moves, so `ctx.fs` still resolves against your local machine. Use bash for anything that touches the workspace.
- **No terminal sessions.** `spawnTerminal()` is not implemented, so PTY-backed tools are unavailable.
- **No `inherit` output.** Use `pipe` or collect.
- **Collect output has no spill file.** Overflowing output keeps a bounded tail and reports truncation without a recovery path.
- **Sessions cannot be reattached.** A dropped connection ends the command, so this is the wrong tool for work that must outlive the harness.
- **`pid` is `-1` briefly.** `spawn()` returns before the session handshake finishes, so a consumer needing a positive pid immediately cannot use this provider unchanged.
- **The seam is pre-1.0.** It is pinned to `0.0.1-rc.1`; expect breaking changes as DeepSeek Harness evolves.
  That release exports the subprocess base class as `SubprocessService`, which the harness has since renamed to
  `SubprocessRuntime`, so this package aliases it at the import and will need a one-line update when a newer
  release lands.

## License

MIT
