# Upstash Box backend for Hermes Agent

Run [Hermes Agent](https://github.com/NousResearch/hermes-agent)'s terminal in an [Upstash Box](https://upstash.com/docs/box), a cloud Linux container.

The agent, your model calls and your sessions stay on your machine. The `terminal`, `execute_code` and file tools run in the Box.

## Quick start

```bash
hermes plugins install upstash-box
hermes plugins enable upstash-box
hermes config set terminal.backend upstash_box
```

The install asks for `UPSTASH_BOX_API_KEY`. Create one in the [Upstash console](https://console.upstash.com).

Then start Hermes and ask it to run something, for example `uname -a`. The first command of a session takes about 10–15 seconds while the Box starts. After that, commands start right away.

## How it works

- **One Box per task, kept between runs.** Each chat or task gets its own Box. On exit it is paused, and the next time that task runs it resumes with your files and installed tools still there.
- **Throwaway Boxes, if you prefer.** With `container_persistent: false`, each session gets a new Box, which is deleted when the session ends.
- **Your skills come along.** Hermes skills and cache are uploaded to `~/.hermes` in the Box, and changes made there are copied back when the session ends.
- **Commands start in `/home/boxuser`.** To start in the Box workspace instead, set `terminal.cwd: /workspace/home`.
- **Background jobs keep running** after the command that started them returns.
- **Timeouts and interrupts** kill the remote command, and Hermes gets the output produced so far.

## Configure

All settings are optional and go under `terminal:` in `~/.hermes/config.yaml`:

```yaml
terminal:
  backend: upstash_box
  container_persistent: true       # false: a new Box per session, deleted at the end
  upstash_box_size: small          # small | medium | large
  upstash_box_runtime: python      # base image: node (default), python, golang, ruby, rust, ...
  upstash_box_keep_alive: false    # never pause Boxes (paid plans)
  upstash_box_labels: [laptop]     # extra labels next to "hermes"
  upstash_box_name_prefix: hermes  # Boxes are named <prefix>-<task id>
```

Set `UPSTASH_BOX_BASE_URL` only to use a different API endpoint.

## Good to know

- **Paused Boxes count toward your Box limit.** The Free plan allows 10 Boxes, which is about ten chats. Clean up with `box list --label hermes`, then delete the Boxes you don't need.
- **The default `node` image has no `pip`.** For Python work, set `upstash_box_runtime: python`. The change applies to newly created Boxes.
- **Use one name prefix per machine.** Two machines with the same prefix share Boxes. Give each its own `upstash_box_name_prefix`.
- **Computer use is not available.** Hermes's `computer_use` does not reach into the Box.

## What leaves your machine

- Every command, and every file the file tools read or write, goes to Upstash Box.
- Your Hermes skills, cache and skill credential files are uploaded to the Box. Changed skill and cache files are copied back.
- Boxes are created, paused and deleted in your account and billed to it.
- If your Upstash account has GitHub connected, every Box holds those credentials in `~/.git-credentials`. Every Box also has an `UPSTASH_BLOB_TOKEN`. Commands the agent runs can use both.
- Your API key is never sent into the Box. No telemetry is sent.

## Requirements

Hermes Agent 0.22.3 or later, and an Upstash account with a Box API key.

## Development

```bash
pip install -e /path/to/hermes-agent "upstash-box>=0.4,<1" pytest ruff
cd packages/hermes-box
ruff check . && ruff format --check .
pytest                                          # unit tests, no network
UPSTASH_BOX_API_KEY=... pytest -m integration   # real Boxes, billed to the key's account
```

## License

MIT
