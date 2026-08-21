# upstash-box

Python SDK for [Upstash Box](https://upstash.com/docs/box) — create sandboxed AI coding agents with streaming, structured output, file I/O, git operations, and snapshots.

Ships both an **async** client (`AsyncBox`) and a **sync** client (`Box`). The sync client is generated from the async source, so both stay in lockstep.

## Installation

```bash
pip install upstash-box
```

## Quick start

```python
import asyncio
from upstash_box import AsyncBox, Agent, ClaudeCode


async def main():
    box = await AsyncBox.create(
        runtime="node",
        agent={"harness": Agent.CLAUDE_CODE, "model": ClaudeCode.SONNET_5},
    )
    async with box:
        run = await box.agent.run(prompt="Create a hello world Express server")
        print(run.result)


asyncio.run(main())
```

Synchronous:

```python
from upstash_box import Box, Agent, ClaudeCode

box = Box.create(
    runtime="node",
    agent={"harness": Agent.CLAUDE_CODE, "model": ClaudeCode.SONNET_5},
)
with box:
    run = box.agent.run(prompt="Create a hello world Express server")
    print(run.result)
```

## Authentication

Pass `api_key` in the config or set the `UPSTASH_BOX_API_KEY` environment variable.

## Lifecycle & transport

Each `Box` / `AsyncBox` owns one pooled HTTP client. Use the context manager (or
call `close()` / `aclose()`) to release it:

```python
box = await AsyncBox.create(...)
async with box:
    ...
# or
box = Box.create(...)
with box:
    ...
```

`delete()` also closes the transport.

## API

### Creating a box

```python
from upstash_box import Agent, AsyncBox, BoxApiKey

box = await AsyncBox.create(
    api_key="box_...",  # or set UPSTASH_BOX_API_KEY
    runtime="node",  # see Runtimes below
    labels=["beta", "x-team"],  # tag the box for organization/filtering
    size="small",  # "small" | "medium" | "large"
    keep_alive=True,
    init_command="npm install && npm run dev",
    agent={
        "harness": Agent.CLAUDE_CODE,
        "model": "anthropic/claude-sonnet-5",
        "api_key": BoxApiKey.UPSTASH_KEY,  # or BoxApiKey.STORED_KEY, or a direct key
    },
    git={"token": "...", "user_name": "Jane", "user_email": "jane@example.com"},
    env={"NODE_ENV": "production"},
)
```

Reconnect or list:

```python
# Reconnecting takes git_token=... (not the git={...} shape used by create()).
# Pass it if you'll use box.git.* (push / create_pr) on the reconnected box.
box = await AsyncBox.get("box_abc123", git_token="ghp_...")
box = await AsyncBox.get_by_name("my-box", git_token="ghp_...")
boxes = await AsyncBox.list()
beta_boxes = await AsyncBox.list(label="beta")  # filter by label
box = await AsyncBox.from_snapshot("snap_abc123", size="medium")
```

### Static methods

Bulk deletion and account-level environment variables (injected into every box
you create):

```python
await AsyncBox.delete_boxes(box_ids=["box_1", "box_2"])  # or a single id
await AsyncBox.delete_snapshots(snapshot_ids=["snap_1"])

await AsyncBox.set_env("API_TOKEN", "secret")
env = await AsyncBox.list_env()  # {"API_TOKEN": "secret"}
await AsyncBox.set_all_env({"A": "1", "B": "2"})  # replaces the whole set
await AsyncBox.delete_env("API_TOKEN")
```

### SSH

You can also connect directly to a box shell:

```bash
ssh <box-id>@us-east-1.box.upstash.com
```

Use your **Box API key** as the SSH password.

### Agent

```python
run = await box.agent.run(prompt="Fix the bug in auth.ts")
print(run.result, run.status, run.cost.total_usd)

# Structured output with Pydantic
from pydantic import BaseModel


class Candidate(BaseModel):
    name: str
    score: int


run = await box.agent.run(prompt="Analyze this candidate", response_schema=Candidate)
result = run.result  # -> Candidate instance

# Streaming
stream = await box.agent.stream(prompt="Refactor the auth flow")
async for chunk in stream:
    if chunk.type == "text-delta":
        print(chunk.text, end="")
    elif chunk.type == "tool-call":
        print(chunk.tool_name, chunk.input)
```

### Exec & code

```python
run = await box.exec.command("node index.js")
run = await box.exec.code(code="print('hi')", lang="python")
print(run.result)  # stdout on success, stderr on failure
print(run.stdout, run.stderr, run.exit_code)  # raw streams + exit code
```

### Live sessions

`exec.command` returns after the command finishes. `exec.session` returns as soon
as it starts, so you can write to stdin, resize a PTY, and signal the process
while it runs.

```python
chunks = []
session = await box.exec.session(
    argv=["sort"],  # exact program + args, no shell
    on_stdout=chunks.append,  # receives bytes as they arrive
)
await session.write("banana\napple\n")
await session.end_stdin()  # EOF, so sort finishes
assert await session.wait() == 0
```

Use `cmd="..."` instead of `argv` to go through `bash -lc`, `tty=True` (with
`rows`/`cols`) for a PTY, and `cwd`/`env` to place the process. Control it with
`resize`, `kill(signal)`, `terminate(grace_ms)`, and `close`.

The session owns the process: closing the handle or losing the connection kills
the command, and sessions cannot be reattached. A context manager makes that
teardown explicit.

```python
async with await box.exec.session(cmd="npm run dev", tty=True, rows=24, cols=80) as dev:
    await dev.write("rs\n")
```

The sync client mirrors this without `await`; its `wait(timeout=None)` blocks and
raises `TimeoutError` if the timeout elapses.

### Files

```python
await box.files.write(path="hello.txt", content="Hello!")
content = await box.files.read("hello.txt")
entries = await box.files.list(".")
await box.files.upload([{"path": "./local.txt", "destination": "remote.txt"}])
await box.files.download(folder="output/")
```

### Git

```python
await box.git.clone(repo="https://github.com/user/repo", branch="main")
await box.git.clone(repo="https://github.com/user/repo", depth=1)  # shallow clone
diff = await box.git.diff()
await box.git.commit(message="feat: add feature")
await box.git.push(branch="main")
pr = await box.git.create_pr(title="New feature", body="Description")
```

### Schedules

```python
await box.schedule.exec(cron="* * * * *", command=["bash", "-c", "date"])
await box.schedule.agent(cron="0 9 * * *", prompt="Run the test suite", timeout=300000)
schedules = await box.schedule.list()
await box.schedule.pause(schedule.id)

# Partial update: omitted fields keep their value; "" / [] / {} clear a
# field, options=None clears agent options. The type cannot be changed.
await box.schedule.update(schedule.id, cron="0 18 * * *", webhook_url="")
```

### Labels

Tag a box for organization and filtering. Set labels at create time (`labels=`) and
manage them on a running box via the `labels` namespace. Each `add`/`remove` returns
the updated label set. Filter with `AsyncBox.list(label=...)`.

```python
labels = await box.labels.add("prod")  # ["beta", "x-team", "prod"]
await box.labels.remove("beta")  # ["x-team", "prod"]
current = await box.labels.list()
```

### Working directory, model, lifecycle

```python
await box.cd("my-project")
print(box.cwd)

await box.configure_model("anthropic/claude-opus-4-8")
print(box.model_config)  # {"harness": ..., "model": ...}

await box.pause()
await box.resume()
status = await box.get_status()
await box.delete()
```

### Snapshots & public URLs

```python
snapshot = await box.snapshot(name="checkpoint-1")
snapshots = await box.list_snapshots()
await box.delete_snapshot(snapshot.id)

url = await box.get_public_url(3000)
urls = await box.list_public_urls()
await box.delete_public_url(3000)
```

### Browser

Create the box with `browser=True` to get a headless Chromium you can drive
through `box.browser` — tab lifecycle, page ops, AI ops (metered), and session
recordings:

```python
box = await AsyncBox.create(runtime="node", browser=True, agent={...})

tab = await box.browser.tab.create("https://example.com")  # wait_until=, timeout=
tabs = await box.browser.list_tabs()

content = await tab.goto("https://news.ycombinator.com")
png = await tab.screenshot()  # bytes; encoding="base64", full_page=True supported


# AI ops (metered) — schema is a Pydantic model or raw dict
class Headline(BaseModel):
    title: str
    points: int


data = await tab.extract("Get the top headline", Headline)
actions = await tab.observe("What can I click?")
await tab.act("Click the first headline")

print(await tab.live_view_url())  # watch the tab live
print(await box.browser.cdp_url())  # connect Playwright/Puppeteer over CDP
await tab.close()

# Recordings
handle = await box.browser.recordings.start(max_duration_seconds=600)
recording = await handle.stop()
recordings = await box.browser.recordings.list()
```

### Ephemeral boxes

```python
from upstash_box import AsyncEphemeralBox

box = await AsyncEphemeralBox.create(runtime="node", ttl=3600)
async with box:
    run = await box.exec.command("echo hello")
    print(run.result)
```

Ephemeral boxes support `exec`, `files`, `schedule`, `cd`, snapshots, `get_status`,
and `delete` — but not `agent`, `git`, `skills`, or the `labels` namespace. They
still accept `labels=` at create time and can be filtered with `AsyncBox.list(label=...)`.

## Runtimes

`runtime` is one of `"node"`, `"python"`, `"golang"`, `"ruby"`, `"rust"`, or
their Alpine variants (`"node-alpine"`, `"python-alpine"`, `"golang-alpine"`,
`"ruby-alpine"`, `"rust-alpine"`).

## Note on timeouts

All `timeout` values are in **milliseconds**, matching the TypeScript SDK
(default `600000`).

## Telemetry

The SDK sends anonymous usage telemetry with every API request, following the
same convention as the other Upstash SDKs: three HTTP headers reporting the SDK
version (`Upstash-Telemetry-Sdk`), the Python runtime
(`Upstash-Telemetry-Runtime`, e.g. `python@3.12.4`), and the deployment
platform (`Upstash-Telemetry-Platform`, e.g. `vercel`). No user data, request
payloads, or identifiers are ever collected.

To opt out, set the `UPSTASH_DISABLE_TELEMETRY` environment variable to any
value.

## License

MIT
