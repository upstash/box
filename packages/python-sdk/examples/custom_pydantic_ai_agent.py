"""Pydantic AI custom harness (https://ai.pydantic.dev).

A production-shaped custom harness that runs a Pydantic AI ``Agent`` *inside* the
box. Box invokes it with ``-p <prompt> --model <model> --stream [--session <id>]``
and passes optional features as environment variables; the harness maps Pydantic
AI onto Box's ``box-sse-v1`` protocol and honors:

  * streaming            -> real text / thinking / tool / tool_result events
  * ``box.agent.run(response_schema=...)``  -> ``JSON_SCHEMA`` env; emits strict JSON
  * ``box.agent.run(files=...)``            -> ``PROMPT_FILES_PATH`` env; attaches files
  * ``box.agent.run(options=...)``          -> ``AGENT_OPTIONS`` env; model settings
  * ``AsyncBox.create(mcp_servers=...)``    -> ``.box-internal/mcp-config.json``; MCP tools
  * multi-turn           -> Box round-trips the ``done`` ``session_id`` as ``--session``
  * token usage          -> input / output / cached tokens on the ``done`` event

Model format is Pydantic AI's ``<provider>:<model-id>``, e.g.
``anthropic:claude-sonnet-4-5``, ``openai:gpt-4o``, ``google-gla:gemini-1.5-flash``.
Set the matching provider key in ``env`` below.

Requires UPSTASH_BOX_API_KEY and ANTHROPIC_API_KEY.
"""

import asyncio
import os

from pydantic import BaseModel

from upstash_box import Agent, AsyncBox

# The harness process. Runs inside the box; depends only on pydantic-ai and the
# `run_custom_harness` helper from upstash-box (both pip-installed below).
HARNESS_SOURCE = r'''
"""In-box Pydantic AI harness. Emits box-sse-v1 on stdout."""

import asyncio
import base64
import json
import os
import sys
import uuid
from pathlib import Path
from typing import Optional

from pydantic import create_model
from pydantic_ai import Agent
from pydantic_ai.messages import (
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    ModelMessagesTypeAdapter,
    PartDeltaEvent,
    PartStartEvent,
    TextPart,
    TextPartDelta,
    ThinkingPart,
    ThinkingPartDelta,
)

from upstash_box import CustomHarnessDone, run_custom_harness

try:
    from pydantic_ai.messages import BinaryContent
except ImportError:  # older pydantic-ai
    BinaryContent = None

try:
    from pydantic_ai.mcp import MCPToolset  # needs pydantic-ai-slim[mcp]
except ImportError:
    MCPToolset = None

SESSIONS_DIR = Path("/workspace/home/.pydantic-ai-sessions")

# Box writes configured MCP servers here (same file the built-in runners read).
MCP_CONFIG_PATH = Path("/workspace/home/.box-internal/mcp-config.json")

# Model settings we forward from AGENT_OPTIONS. Restricted to a safe subset so an
# arbitrary options dict can't break the run with provider-rejected keys.
SAFE_SETTINGS = {
    "temperature", "max_tokens", "top_p", "seed",
    "timeout", "presence_penalty", "frequency_penalty",
}

TEXT_MIME_EXACT = {
    "application/json", "application/xml", "application/yaml", "application/x-yaml",
    "application/toml", "application/javascript", "application/typescript",
    "application/sql", "application/graphql",
}


# ---- optional-feature env parsing -------------------------------------------

def _model_settings():
    raw = os.environ.get("AGENT_OPTIONS")
    if not raw:
        return None
    try:
        opts = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(opts, dict):
        return None
    # Some SDK paths wrap the user's options under an "agentOptions" key.
    inner = opts.get("agentOptions")
    if isinstance(inner, dict):
        opts = inner
    settings = {k: v for k, v in opts.items() if k in SAFE_SETTINGS}
    return settings or None


def _load_mcp_toolsets():
    """Build MCP toolsets from the box's mcp-config.json (url + npm sources)."""
    if MCPToolset is None or not MCP_CONFIG_PATH.exists():
        return []
    try:
        configs = json.loads(MCP_CONFIG_PATH.read_text())
    except (OSError, json.JSONDecodeError):
        return []
    toolsets = []
    for cfg in configs:
        name = cfg.get("name")
        target = cfg.get("package_or_url")
        try:
            if cfg.get("source") == "url":
                toolsets.append(MCPToolset(target, headers=cfg.get("headers") or {}, id=name))
            elif cfg.get("source") == "npm":
                # stdio server via npx (requires node in the box)
                spec = {"command": "npx", "args": ["-y", target, *(cfg.get("args") or [])]}
                toolsets.append(MCPToolset({"mcpServers": {name: spec}}, id=name))
        except Exception as exc:  # noqa: BLE001 - one bad server shouldn't kill the run
            print(f"[pydantic-ai] skipping MCP server {name!r}: {exc}", file=sys.stderr)
    return toolsets


def _is_text_mime(mime):
    mime = (mime or "").split(";")[0]
    return mime.startswith("text/") or mime in TEXT_MIME_EXACT


def _load_prompt_files():
    """Consume PROMPT_FILES_PATH -> (text_note, [binary parts])."""
    path = os.environ.get("PROMPT_FILES_PATH")
    if not path or not os.path.exists(path):
        return "", []
    try:
        files = json.loads(Path(path).read_text())
    except (OSError, json.JSONDecodeError):
        return "", []
    try:
        os.unlink(path)
    except OSError:
        pass

    notes, binaries = [], []
    for f in files:
        try:
            data = base64.b64decode(f.get("data") or "")
        except ValueError:
            continue  # skip a malformed attachment rather than abort the run
        name = f.get("filename") or "unnamed"
        mime = f.get("media_type") or "application/octet-stream"
        if _is_text_mime(mime):
            body = data.decode("utf-8", "replace")
            notes.append(f"\n\nAttached file: {name}\n```\n{body}\n```")
        elif BinaryContent is not None:
            binaries.append(BinaryContent(data=data, media_type=mime))
    return "".join(notes), binaries


# ---- JSON Schema -> pydantic model (for native structured output) -----------

_PRIMITIVES = {"string": str, "integer": int, "number": float, "boolean": bool}


def _py_type(prop):
    kind = prop.get("type")
    if isinstance(kind, list):  # e.g. ["string", "null"]
        kind = next((k for k in kind if k != "null"), "string")
    if kind in _PRIMITIVES:
        return _PRIMITIVES[kind]
    if kind == "array":
        items = prop.get("items") or {}
        return list[_py_type(items)] if items else list
    if kind == "object" and prop.get("properties"):
        return _model_from_schema(prop)
    return object  # unconstrained / any


def _model_from_schema(schema, name="Output"):
    props = schema.get("properties") or {}
    required = set(schema.get("required") or [])
    fields = {}
    for key, prop in props.items():
        typ = _py_type(prop)
        fields[key] = (typ, ...) if key in required else (Optional[typ], None)
    return create_model(name, **fields) if fields else dict


# ---- session history ---------------------------------------------------------

def _history_path(session_id):
    return SESSIONS_DIR / f"{session_id}.json"


def _load_history(session_id):
    path = _history_path(session_id)
    if not path.exists():
        return None
    return ModelMessagesTypeAdapter.validate_json(path.read_bytes())


def _save_history(session_id, messages):
    SESSIONS_DIR.mkdir(parents=True, exist_ok=True)
    _history_path(session_id).write_bytes(ModelMessagesTypeAdapter.dump_json(messages))


# ---- token usage -------------------------------------------------------------

def _usage_val(usage, *names):
    details = getattr(usage, "details", None) or {}
    for name in names:
        val = getattr(usage, name, None) or details.get(name)
        if val:
            return val
    return 0


async def main():
    async def handler(ctx, emit):
        model = ctx.model or "anthropic:claude-sonnet-4-5"
        # No --session on the first turn; mint one and report it back in `done`
        # so Box hands it to us as --session on the next turn.
        session_id = ctx.session_id or uuid.uuid4().hex
        schema = os.environ.get("JSON_SCHEMA")

        note, binaries = _load_prompt_files()
        user_input = [ctx.prompt + note, *binaries] if (note or binaries) else ctx.prompt
        history = _load_history(session_id)
        settings = _model_settings()
        toolsets = _load_mcp_toolsets()  # MCP servers, if any were configured

        if schema:
            # Structured output: provider-enforced via a model built from the
            # schema. The done `output` must be pure JSON for the SDK to parse.
            output_type = _model_from_schema(json.loads(schema))
            agent = Agent(model, output_type=output_type, toolsets=toolsets)
            async with agent:  # starts MCP servers; no-op when there are none
                result = await agent.run(
                    user_input, message_history=history, model_settings=settings
                )
            value = result.output
            if hasattr(value, "model_dump_json"):
                output = value.model_dump_json()
            else:
                output = json.dumps(value)
            emit.text(output)
            usage = result.usage
        else:
            agent = Agent(model, toolsets=toolsets)

            @agent.tool_plain
            def list_directory(path: str = ".") -> list[str]:
                """List the entries of a directory inside the sandbox."""
                try:
                    return sorted(os.listdir(path))
                except OSError as exc:
                    return [f"error: {exc}"]

            streamed = ""
            async with agent, agent.iter(
                user_input, message_history=history, model_settings=settings
            ) as run:
                async for node in run:
                    if Agent.is_model_request_node(node):
                        async with node.stream(run.ctx) as request_stream:
                            async for event in request_stream:
                                if isinstance(event, PartStartEvent):
                                    part = event.part
                                    if isinstance(part, TextPart) and part.content:
                                        streamed += part.content
                                        emit.text(part.content)
                                    elif isinstance(part, ThinkingPart) and part.content:
                                        emit.reasoning(part.content)
                                elif isinstance(event, PartDeltaEvent):
                                    delta = event.delta
                                    text = getattr(delta, "content_delta", None)
                                    if isinstance(delta, TextPartDelta) and text:
                                        streamed += text
                                        emit.text(text)
                                    elif isinstance(delta, ThinkingPartDelta) and text:
                                        emit.reasoning(text)
                    elif Agent.is_call_tools_node(node):
                        async with node.stream(run.ctx) as tool_stream:
                            async for event in tool_stream:
                                if isinstance(event, FunctionToolCallEvent):
                                    part = event.part
                                    args = part.args
                                    if isinstance(args, str):
                                        try:
                                            args = json.loads(args)
                                        except json.JSONDecodeError:
                                            args = {"raw": args}
                                    emit.tool({
                                        "tool_call_id": part.tool_call_id,
                                        "name": part.tool_name,
                                        "input": args or {},
                                    })
                                elif isinstance(event, FunctionToolResultEvent):
                                    part = event.part  # ToolReturnPart
                                    emit.tool_result({
                                        "tool_call_id": getattr(part, "tool_call_id", None),
                                        "output": str(getattr(part, "content", part)),
                                    })

            result = run.result
            output = str(result.output if result.output is not None else streamed)
            usage = run.usage

        _save_history(session_id, result.all_messages())

        # `usage` is a property in newer pydantic-ai, a method in older.
        usage = usage() if callable(usage) else usage
        return CustomHarnessDone(
            output=output,
            input_tokens=_usage_val(usage, "input_tokens", "request_tokens"),
            output_tokens=_usage_val(usage, "output_tokens", "response_tokens"),
            cached_input_tokens=_usage_val(
                usage, "cache_read_tokens", "cache_read_input_tokens", "cached_tokens"
            ),
            session_id=session_id,
        )

    await run_custom_harness(handler)


if __name__ == "__main__":
    asyncio.run(main())
'''


# Structured-output schema for the demo below.
class ChatSummary(BaseModel):
    codename: str
    topics: list[str]
    turns: int


async def main() -> None:
    box = await AsyncBox.create(
        runtime="python",
        agent={
            "harness": Agent.CUSTOM,
            "model": "anthropic:claude-sonnet-4-5",
            "custom_harness": {
                "command": "python",
                "args": ["/workspace/home/custom_pydantic_ai_agent.py"],
                "protocol": "box-sse-v1",
            },
        },
        env={
            k: v
            for k in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY")
            if (v := os.environ.get(k))  # only forward keys that are actually set
        },
        # Box writes these to .box-internal/mcp-config.json; the harness reads them.
        mcp_servers=[{"name": "deepwiki", "url": "https://mcp.deepwiki.com/mcp"}],
    )
    print(f"Created box: {box.id}")

    try:
        print("Installing pydantic-ai + upstash-box in the box...")
        await box.exec.command("pip install --quiet 'pydantic-ai-slim[anthropic,mcp]' upstash-box")
        await box.files.write(path="custom_pydantic_ai_agent.py", content=HARNESS_SOURCE)

        print("\n=== Turn 1 (tool use + streaming) ===")
        run1 = await box.agent.run(
            prompt=(
                "List the files in /workspace/home, then in one sentence say what "
                "an Upstash Box is, and pick a short codename for this chat."
            ),
            on_tool_use=lambda t: print(f"  [tool] {t['name']}({t['input']})"),
        )
        print(run1.result)

        print("\n=== Turn 2 (multi-turn recall) ===")
        run2 = await box.agent.run(prompt="What codename did you pick?")
        print(run2.result)

        print("\n=== Turn 3 (MCP tool use) ===")
        run_mcp = await box.agent.run(
            prompt=(
                "Use the deepwiki tools to tell me in one sentence what the GitHub "
                "repository facebook/react is."
            ),
            on_tool_use=lambda t: print(f"  [MCP tool] {t['name']}"),
        )
        print(run_mcp.result)

        print("\n=== Turn 4 (structured output) ===")
        run4 = await box.agent.run(
            prompt="Summarize this conversation.",
            response_schema=ChatSummary,
        )
        summary = run4.result  # -> ChatSummary instance
        print(summary)
        print(
            "input/output/cached tokens:",
            run4.cost.input_tokens,
            run4.cost.output_tokens,
            run4.cost.cached_input_tokens,
        )
    finally:
        await box.delete()  # also closes the transport
        print("\nBox deleted.")


if __name__ == "__main__":
    asyncio.run(main())
