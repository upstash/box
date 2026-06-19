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
        agent={"harness": Agent.CLAUDE_CODE, "model": ClaudeCode.SONNET_4_5},
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
    agent={"harness": Agent.CLAUDE_CODE, "model": ClaudeCode.SONNET_4_5},
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
    api_key="box_...",            # or set UPSTASH_BOX_API_KEY
    runtime="node",                # "node" | "python" | "golang" | "ruby" | "rust"
    size="small",                  # "small" | "medium" | "large"
    keep_alive=True,
    init_command="npm install && npm run dev",
    agent={
        "harness": Agent.CLAUDE_CODE,
        "model": "anthropic/claude-sonnet-4-5",
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
box = await AsyncBox.from_snapshot("snap_abc123", size="medium")
```

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
```

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
```

### Working directory, model, lifecycle

```python
await box.cd("my-project")
print(box.cwd)

await box.configure_model("anthropic/claude-opus-4-5")
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

### Ephemeral boxes

```python
from upstash_box import AsyncEphemeralBox

box = await AsyncEphemeralBox.create(runtime="node", ttl=3600)
async with box:
    run = await box.exec.command("echo hello")
    print(run.result)
```

Ephemeral boxes support `exec`, `files`, `schedule`, `cd`, snapshots, `get_status`,
and `delete` — but not `agent`, `git`, or `skills`.

## Note on timeouts

All `timeout` values are in **milliseconds**, matching the TypeScript SDK
(default `600000`).

## License

MIT
