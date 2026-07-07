"""CrewAI custom harness (https://docs.crewai.com).

A production-shaped custom harness that runs a CrewAI ``Crew`` *inside* the box.
Box invokes it with ``-p <prompt> --model <model> --stream`` and passes optional
features as environment variables; the harness maps CrewAI onto Box's
``box-sse-v1`` protocol and honors:

  * tool events          -> ``tool`` / ``tool_result`` for every tool via the event bus
  * ``box.agent.run(response_schema=...)``  -> ``JSON_SCHEMA`` env; native ``output_pydantic``
  * ``box.agent.run(files=...)``            -> ``PROMPT_FILES_PATH`` env; text files inlined
  * ``box.agent.run(options=...)``          -> ``AGENT_OPTIONS`` env; LLM settings
  * ``AsyncBox.create(mcp_servers=...)``    -> ``.box-internal/mcp-config.json``; MCP tools
  * token usage          -> prompt / completion / cached tokens on the ``done`` event

CrewAI has no native token streaming and isn't built around resumable chat
sessions, so the harness emits the final answer as one ``text`` event and is
single-turn. For streaming, multi-turn conversations, see
``custom_pydantic_ai_agent.py``.

Model format is CrewAI/LiteLLM's ``<provider>/<model-id>``, e.g.
``anthropic/claude-sonnet-4-5``, ``openai/gpt-4o``, ``gemini/gemini-1.5-pro``.
Set the matching provider key in ``env`` below.

Requires UPSTASH_BOX_API_KEY and ANTHROPIC_API_KEY.
"""

import asyncio
import os

from pydantic import BaseModel

from upstash_box import Agent, AsyncBox

# The harness process. Runs inside the box; depends only on crewai and the
# `run_custom_harness` helper from upstash-box (both pip-installed below).
HARNESS_SOURCE = r'''
"""In-box CrewAI harness. Emits box-sse-v1 on stdout."""

import asyncio
import base64
import json
import os
import sys
from pathlib import Path
from typing import Optional

from crewai import LLM, Agent, Crew, Task
from crewai.tools import tool
from pydantic import create_model

from upstash_box import CustomHarnessDone, run_custom_harness

try:
    from crewai_tools import MCPServerAdapter  # needs crewai-tools[mcp]
except ImportError:
    MCPServerAdapter = None

# Box writes configured MCP servers here (same file the built-in runners read).
MCP_CONFIG_PATH = Path("/workspace/home/.box-internal/mcp-config.json")

# LLM settings we forward from AGENT_OPTIONS, restricted to a safe subset.
SAFE_SETTINGS = {"temperature", "max_tokens", "top_p", "seed",
                 "presence_penalty", "frequency_penalty"}

TEXT_MIME_EXACT = {
    "application/json", "application/xml", "application/yaml", "application/x-yaml",
    "application/toml", "application/javascript", "application/typescript",
    "application/sql", "application/graphql",
}

_PRIMITIVES = {"string": str, "integer": int, "number": float, "boolean": bool}


# ---- JSON Schema -> pydantic model (for native structured output) -----------

def _py_type(prop):
    kind = prop.get("type")
    if isinstance(kind, list):
        kind = next((k for k in kind if k != "null"), "string")
    if kind in _PRIMITIVES:
        return _PRIMITIVES[kind]
    if kind == "array":
        items = prop.get("items") or {}
        return list[_py_type(items)] if items else list
    if kind == "object" and prop.get("properties"):
        return _model_from_schema(prop)
    return object


def _model_from_schema(schema, name="Output"):
    props = schema.get("properties") or {}
    required = set(schema.get("required") or [])
    fields = {}
    for key, prop in props.items():
        typ = _py_type(prop)
        fields[key] = (typ, ...) if key in required else (Optional[typ], None)
    return create_model(name, **fields) if fields else None


# ---- optional-feature env parsing -------------------------------------------

def _llm_settings():
    raw = os.environ.get("AGENT_OPTIONS")
    if not raw:
        return {}
    try:
        opts = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    if not isinstance(opts, dict):
        return {}
    # Some SDK paths wrap the user's options under an "agentOptions" key.
    inner = opts.get("agentOptions")
    if isinstance(inner, dict):
        opts = inner
    return {k: v for k, v in opts.items() if k in SAFE_SETTINGS}


def _mcp_server_params():
    """Read the box's mcp-config.json into crewai-tools MCPServerAdapter params."""
    if MCPServerAdapter is None or not MCP_CONFIG_PATH.exists():
        return []
    try:
        configs = json.loads(MCP_CONFIG_PATH.read_text())
    except (OSError, json.JSONDecodeError):
        return []
    params = []
    for cfg in configs:
        if cfg.get("source") == "url":
            params.append({
                "url": cfg["package_or_url"],
                "transport": "streamable-http",
                **({"headers": cfg["headers"]} if cfg.get("headers") else {}),
            })
        # npm/stdio servers need node in the box; skipped here for portability.
    return params


def _register_tool_events(emit):
    """Bridge CrewAI's event bus onto box-sse-v1, capturing every tool call
    (local and MCP) uniformly — like the built-in runners."""
    try:
        from crewai.events import crewai_event_bus
        from crewai.events.types.tool_usage_events import (
            ToolUsageErrorEvent,
            ToolUsageFinishedEvent,
            ToolUsageStartedEvent,
        )
    except ImportError:
        return

    @crewai_event_bus.on(ToolUsageStartedEvent)
    def _on_start(source, event):  # noqa: ARG001
        emit.tool({
            "tool_call_id": event.event_id,
            "name": event.tool_name,
            "input": event.tool_args or {},
        })

    @crewai_event_bus.on(ToolUsageFinishedEvent)
    def _on_finish(source, event):  # noqa: ARG001
        emit.tool_result({
            "tool_call_id": getattr(event, "started_event_id", None) or event.event_id,
            "output": str(event.output),
        })

    @crewai_event_bus.on(ToolUsageErrorEvent)
    def _on_error(source, event):  # noqa: ARG001
        emit.tool_result({
            "tool_call_id": getattr(event, "started_event_id", None) or event.event_id,
            "output": f"error: {event.error}",
        })


def _is_text_mime(mime):
    mime = (mime or "").split(";")[0]
    return mime.startswith("text/") or mime in TEXT_MIME_EXACT


def _prompt_files_note():
    """Consume PROMPT_FILES_PATH and inline text files. Binary files are skipped
    (a basic Crew has no image input) with a note on stderr."""
    path = os.environ.get("PROMPT_FILES_PATH")
    if not path or not os.path.exists(path):
        return ""
    try:
        files = json.loads(Path(path).read_text())
    except (OSError, json.JSONDecodeError):
        return ""
    try:
        os.unlink(path)
    except OSError:
        pass

    notes = []
    for f in files:
        name = f.get("filename") or "unnamed"
        mime = f.get("media_type") or "application/octet-stream"
        if _is_text_mime(mime):
            try:
                body = base64.b64decode(f.get("data") or "").decode("utf-8", "replace")
            except ValueError:
                continue  # skip a malformed attachment rather than abort the run
            notes.append(f"\n\nAttached file: {name}\n```\n{body}\n```")
        else:
            print(f"[crewai] skipping non-text attachment: {name} ({mime})", file=sys.stderr)
    return "".join(notes)


async def main():
    async def run(ctx, emit):
        _register_tool_events(emit)  # surfaces every tool call (local + MCP)

        model = ctx.model or "anthropic/claude-sonnet-4-5"
        llm = LLM(model=model, **_llm_settings())

        @tool("list_directory")
        def list_directory(path: str = ".") -> str:
            """List the entries of a directory inside the sandbox."""
            try:
                return "\n".join(sorted(os.listdir(path)))
            except OSError as exc:
                return f"error: {exc}"

        def step_callback(step):
            thought = getattr(step, "thought", None)
            if thought:
                emit.reasoning(str(thought))

        schema_raw = os.environ.get("JSON_SCHEMA")
        description = ctx.prompt + _prompt_files_note()
        expected = "A helpful, direct response to the task."
        output_model = _model_from_schema(json.loads(schema_raw)) if schema_raw else None
        task_kwargs = {}
        if output_model is not None:
            task_kwargs["output_pydantic"] = output_model
            expected = "A structured object matching the requested schema."

        async def run_crew(tools):
            assistant = Agent(
                role="Assistant",
                goal="Complete the user's task accurately and concisely.",
                backstory="A capable AI assistant running inside an Upstash Box sandbox.",
                llm=llm,
                tools=tools,
                verbose=False,
            )
            task = Task(
                description=description, expected_output=expected,
                agent=assistant, **task_kwargs,
            )
            crew = Crew(agents=[assistant], tasks=[task], step_callback=step_callback)
            # kickoff_async() is required: run_custom_harness runs us in an event loop.
            return await crew.kickoff_async(), crew

        mcp_params = _mcp_server_params()
        if mcp_params:
            # MCPServerAdapter is a sync context manager; keep it open during kickoff.
            with MCPServerAdapter(mcp_params) as mcp_tools:
                result, crew = await run_crew([list_directory, *mcp_tools])
        else:
            result, crew = await run_crew([list_directory])

        if output_model is not None and getattr(result, "pydantic", None):
            output = result.pydantic.model_dump_json()
        else:
            output = str(getattr(result, "raw", result))
        emit.text(output)

        usage = getattr(crew, "usage_metrics", None)
        return CustomHarnessDone(
            output=output,
            input_tokens=getattr(usage, "prompt_tokens", 0) or 0,
            output_tokens=getattr(usage, "completion_tokens", 0) or 0,
            cached_input_tokens=getattr(usage, "cached_prompt_tokens", 0) or 0,
            session_id=ctx.session_id,
        )

    await run_custom_harness(run)


if __name__ == "__main__":
    asyncio.run(main())
'''


# Structured-output schema for the demo below.
class DirReport(BaseModel):
    files: list[str]
    summary: str


async def main() -> None:
    box = await AsyncBox.create(
        runtime="python",
        agent={
            "harness": Agent.CUSTOM,
            "model": "anthropic/claude-sonnet-4-5",
            "custom_harness": {
                "command": "python",
                "args": ["/workspace/home/custom_crewai_agent.py"],
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
        print("Installing crewai + upstash-box in the box (this can take a minute)...")
        await box.exec.command(
            "pip install --quiet 'crewai[anthropic]' 'crewai-tools[mcp]' upstash-box"
        )
        await box.files.write(path="custom_crewai_agent.py", content=HARNESS_SOURCE)

        print("\n=== Run 1 (tool use) ===")
        run1 = await box.agent.run(
            prompt="List the files in /workspace/home and describe what's there in one line.",
            on_tool_use=lambda t: print(f"  [tool] {t['name']}({t['input']})"),
        )
        print(run1.result)

        print("\n=== Run 2 (MCP tool use) ===")
        run_mcp = await box.agent.run(
            prompt=(
                "Use the deepwiki tools to tell me in one sentence what the GitHub "
                "repository facebook/react is."
            ),
            on_tool_use=lambda t: print(f"  [MCP tool] {t['name']}"),
        )
        print(run_mcp.result)

        print("\n=== Run 3 (structured output) ===")
        run2 = await box.agent.run(
            prompt="List the files in /workspace/home and summarize them.",
            response_schema=DirReport,
        )
        report = run2.result  # -> DirReport instance
        print(report)
        print(
            "prompt/completion/cached tokens:",
            run2.cost.input_tokens,
            run2.cost.output_tokens,
            run2.cost.cached_input_tokens,
        )
    finally:
        await box.delete()  # also closes the transport
        print("\nBox deleted.")


if __name__ == "__main__":
    asyncio.run(main())
