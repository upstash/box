# hermes-box

Run [Hermes Agent](https://github.com/NousResearch/hermes-agent) terminal work inside a remote [Upstash Box](https://upstash.com/docs/box).

The agent keeps running locally: your model calls, sessions, memory and approvals stay on your machine. Only the execution world moves. The `terminal`, `execute_code` and file tools (`read_file`, `write_file`, `patch`, `search_files`) run in a Box, a cloud Linux container with its own filesystem. Commands execute there, not on your machine. Two things do cross over, both through Hermes file sync: your skills, cache and skill-registered credential files are uploaded to the Box, and skill and cache files changed in the Box are copied back onto your machine (see below).

This is a Hermes terminal backend plugin. It registers the backend `upstash_box`, which you select like a built-in one with `terminal.backend`.

## Install

```bash
hermes plugins install upstash/box#packages/hermes-box
hermes plugins enable upstash-box
```

The install prompts for `UPSTASH_BOX_API_KEY` and saves it to `~/.hermes/.env`. Create a Box API key in the [Upstash console](https://console.upstash.com). The plugin depends on the [`upstash-box`](https://pypi.org/project/upstash-box/) Python SDK, which Hermes installs from `pyproject.toml` after you consent.

Then select the backend:

```bash
hermes config set terminal.backend upstash_box
```

or pick **Upstash Box** in `hermes setup terminal`. `hermes doctor` shows whether the SDK and the key are in place.

## Configure

The defaults work as-is. All keys are optional and live under `terminal:` in `~/.hermes/config.yaml`:

```yaml
terminal:
  backend: upstash_box
  container_persistent: true      # pause and resume one Box per task (false: one Box per session, deleted when it ends)
  upstash_box_size: small         # small | medium | large
  upstash_box_runtime: python     # Box base image: node, python, golang, ruby, rust, ... (default: the Box default)
  upstash_box_keep_alive: false   # create keep-alive Boxes (never paused; paid plans)
  upstash_box_labels: [laptop]    # extra labels next to "hermes" (at most 4 extra, 20 characters each)
  upstash_box_name_prefix: hermes # Box names are <prefix>-<task id>
```

| Setting / env var                 | Default                    | Meaning                                                                                    |
| --------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------ |
| `UPSTASH_BOX_API_KEY`             | required                   | Account credential. Read through Hermes's secret scope, never sent into the Box.           |
| `UPSTASH_BOX_BASE_URL`            | the SDK default            | API endpoint, read through the secret scope like the key. Unset means the SDK default endpoint, never another profile's value. |
| `terminal.container_persistent`   | `true`                     | Persistence mode, see below.                                                               |
| `terminal.upstash_box_size`       | `small`                    | Box size. An unknown value falls back to `small` with a warning.                           |
| `terminal.upstash_box_runtime`    | Box default                | Base image of new Boxes. A batch run's per-task image override is used as the runtime.     |
| `terminal.upstash_box_keep_alive` | `false`                    | Keep-alive Boxes are left running on exit instead of paused.                               |
| `terminal.upstash_box_labels`     | none                       | Extra labels, as a list or a comma-separated string.                                       |
| `terminal.upstash_box_name_prefix`| `hermes`                   | Prefix of Box names. Set a different one per machine to keep their Boxes apart.            |

`terminal.container_cpu`, `container_memory` and `container_disk` do not apply: Boxes come in fixed sizes.

## How it behaves

- **Persistent mode** (`container_persistent: true`, the default). Each task gets a Box named `hermes-<task id>`. When Hermes starts the task again it looks the Box up by name and resumes it, so files and installed tools are still there. On exit the Box is paused, not deleted. A Box in the error state is reported rather than replaced, so nothing is lost silently.
- **Per-session isolation** (`container_persistent: false`). Every session creates its own Box, `hermes-<task id>-<random suffix>`, and deletes it when the session ends. The Box lasts for the whole session, so files carry over from one turn to the next. Two sessions never attach the same Box, so one can never delete the other's. The plugin only ever deletes the Box it created in that session; it never deletes by name, label or list. If the delete fails it retries a temporary failure a few times, and otherwise keeps the Box so a later cleanup can try again; a Box that is already gone counts as deleted.
- **Commands run in exec sessions.** Each command is a live Box exec session running `bash`. The command itself starts only after Hermes has registered the session, so an interrupt that arrives while the session is opening means the command never runs. Stdout and stderr stream back merged, in arrival order, into Hermes's usual output handling, which caps what the terminal tool keeps. Stdin is streamed into the session and then always closed, so a command reading stdin sees EOF instead of hanging; a failed stdin write is reported with the result.
- **Timeouts and interrupts kill the remote process tree.** A command that runs past its timeout, or that you interrupt, gets `SIGKILL` through the session and comes back as exit code `124` (timeout) or `130` (interrupt) with the output so far.
- **The working directory is the Box home** (`/workspace/home`). A `cd` carries over to later commands, like the other Hermes backends.
- **A Box paused behind Hermes's back is resumed.** If a command finds its Box paused (from the console, or an idle pause), the plugin resumes it once and retries.
- **A Box deleted behind Hermes's back is replaced.** If a command finds that its Box no longer exists, it says so and does not run; the next command runs in a new Box, and Hermes tells the model the environment was recreated. A Box in the error state is reported, not replaced.
- **Your Hermes files are synced.** Skills, the cache and credential files registered by skills are uploaded to `~/.hermes` in the Box before commands run and kept in sync. When the Box is cleaned up, skill and cache files changed in the Box are copied back to your machine, replacing the host copy even if you changed it in the meantime (credential files are upload-only).
- **The API key stays on your machine.** It is listed in the backend's `strip_env_keys`, so Hermes strips it from every process it spawns, and it is never passed into the Box or logged.
- **Dangerous-command approval is skipped inside the Box**, as for the other cloud backends (Daytona, Modal), because commands run in the Box, not on your machine. Sync-back can still change skill and cache files on your machine.

## What leaves your machine

Before you install, know that this plugin:

- sends every command the agent runs, and the files the file tools read and write, to Upstash Box over the network;
- uploads your Hermes skills, cache and skill-registered credential files to `~/.hermes` in the Box;
- copies skill and cache files changed in the Box back onto your machine when the Box is cleaned up;
- creates, pauses, resumes and deletes Boxes in the Upstash account of your API key. Boxes are billed to that account, and paused Boxes keep their storage;
- reads `UPSTASH_BOX_API_KEY` (and `UPSTASH_BOX_BASE_URL` if set) through Hermes's secret scope. It reads no other credential store.

It sends no telemetry: the `upstash-box` SDK adds anonymous telemetry headers (SDK version, Python version, platform) unless `UPSTASH_DISABLE_TELEMETRY` is set, so the plugin sets `UPSTASH_DISABLE_TELEMETRY=1` in the Hermes process when it is unset, before it creates any SDK client. It never updates itself.

## Requirements

- Hermes Agent `>=0.22.3` (the first release that uses a plugin backend's `default_cwd`, so commands start in the Box home) with `plugins.isolation: in_process` (the default). A terminal backend cannot run in the plugin host.
- Python `>=3.11` and `upstash-box>=0.4,<1`.
- An Upstash account with a Box API key.

## Limitations

- **No Bot Desktop or `computer_use` in the Box.** The backend does not declare `supports_streams`, because no local command reaches a Box session with stdin and stdout open. The screen stays where Hermes puts it without this backend.
- **Sessions cannot be reattached.** A dropped connection ends the command. A process started in the background (`cmd &`) belongs to its command's session, so it may stop when that command returns; this has not been characterized against the live API yet.
- **Box names are per account.** Two machines with the same `name_prefix` and task id resume the same persistent Box. Give each machine its own `upstash_box_name_prefix` if that matters.
- **Other Box states get no special handling.** Running, paused, deleted and error are handled as above. A Box in any other state (for example stopped) is used as it is; if a command cannot start, the error is reported.
- **Pausing a keep-alive Box is not possible.** Keep-alive Boxes stay running after Hermes exits until you pause or delete them yourself.
- **Leftover Boxes after a crash.** If Hermes is killed before cleanup, a non-persistent Box stays in your account. Find them with the `hermes` label (`box list --label hermes`) and delete them.

## Development

The tests import Hermes core, so install a hermes-agent checkout first:

```bash
pip install -e /path/to/hermes-agent "upstash-box>=0.4,<1" pytest ruff
cd packages/hermes-box
ruff check . && ruff format --check .
pytest                                   # unit tests, no network
UPSTASH_BOX_API_KEY=... pytest -m integration   # real Boxes, billed to the key's account
```

Unit tests run against a fake SDK whose Boxes are temporary directories and whose exec sessions are local `bash` processes, so the real Hermes command path (snapshot, cwd tracking, stdin, timeouts, kills, file sync) is exercised without network. `tests/test_sdk_transport.py` runs the plugin on the real `upstash-box` SDK against a local stand-in for the Box API: REST calls go through a mocked `httpx` transport and exec sessions over a local WebSocket. `hermes plugins validate packages/hermes-box` runs the catalog checks.

## License

MIT
