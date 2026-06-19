"""Helper for implementing a Box custom harness process.

The backend runs your command with ``-p <prompt> --model <model> --stream`` and
optionally ``--session <sessionId>``. This module parses those arguments and
emits the ``box-sse-v1`` protocol Box expects on stdout.
"""

from __future__ import annotations

import inspect
import json
import sys
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, List, Optional, Union


@dataclass
class CustomHarnessContext:
    prompt: str
    model: str
    stream: bool
    args: List[str]
    session_id: Optional[str] = None


@dataclass
class CustomHarnessDone:
    output: str
    input_tokens: int = 0
    output_tokens: int = 0
    cached_input_tokens: int = 0
    total_cost_usd: float = 0
    session_id: Optional[str] = None


class CustomHarnessEmitter:
    def __init__(self, write: Callable[[str], None]) -> None:
        self._write = write

    def emit(self, event: str, data: Any) -> None:
        self._write(f"event: {event}\n")
        self._write(f"data: {json.dumps(data, separators=(',', ':'))}\n\n")

    def text(self, text: str) -> None:
        self.emit("text", {"text": text})

    def reasoning(self, text: str) -> None:
        self.emit("thinking", {"text": text})

    def tool(self, tool: Dict[str, Any]) -> None:
        self.emit(
            "tool",
            {
                "toolCallId": tool.get("tool_call_id"),
                "name": tool.get("name"),
                "input": tool.get("input") or {},
            },
        )

    def tool_result(self, result: Dict[str, Any]) -> None:
        self.emit(
            "tool_result",
            {
                "toolCallId": result.get("tool_call_id"),
                "output": result.get("output"),
            },
        )

    def done(self, result: CustomHarnessDone) -> None:
        self.emit(
            "done",
            {
                "output": result.output,
                "input_tokens": result.input_tokens,
                "output_tokens": result.output_tokens,
                "cached_input_tokens": result.cached_input_tokens,
                "total_cost_usd": result.total_cost_usd,
                "session_id": result.session_id or "",
            },
        )

    def error(
        self, error: Union[Exception, str], metadata: Optional[Dict[str, Any]] = None
    ) -> None:
        metadata = metadata or {}
        self.emit(
            "error",
            {
                "error": str(error),
                "input_tokens": metadata.get("input_tokens", 0),
                "output_tokens": metadata.get("output_tokens", 0),
                "cached_input_tokens": metadata.get("cached_input_tokens", 0),
                "total_cost_usd": metadata.get("total_cost_usd", 0),
                "session_id": metadata.get("session_id", ""),
            },
        )


CustomHarnessHandler = Callable[
    [CustomHarnessContext, CustomHarnessEmitter],
    Union[CustomHarnessDone, str, None, Awaitable[Union[CustomHarnessDone, str, None]]],
]


def _read_arg(args: List[str], names: List[str], fallback: str = "") -> str:
    for name in names:
        if name in args:
            i = args.index(name)
            if i + 1 < len(args):
                return args[i + 1]
    return fallback


def _has_flag(args: List[str], name: str) -> bool:
    return name in args


async def run_custom_harness(
    handler: CustomHarnessHandler,
    *,
    argv: Optional[List[str]] = None,
    write: Optional[Callable[[str], None]] = None,
) -> None:
    """Implement a Box custom harness process.

    ``handler`` may be sync or async. Returning a string emits a ``done`` event
    with that output; returning a ``CustomHarnessDone`` emits its full payload.
    """
    argv = argv if argv is not None else sys.argv[1:]

    def _default_write(chunk: str) -> None:
        sys.stdout.write(chunk)
        sys.stdout.flush()  # stream promptly to the backend (no buffering wait)

    out_write: Callable[[str], None] = write or _default_write
    emit = CustomHarnessEmitter(out_write)
    context = CustomHarnessContext(
        prompt=_read_arg(argv, ["-p", "--prompt"]),
        model=_read_arg(argv, ["--model"], "custom"),
        session_id=_read_arg(argv, ["--session"]) or None,
        stream=_has_flag(argv, "--stream"),
        args=argv,
    )

    try:
        result = handler(context, emit)
        if inspect.isawaitable(result):
            result = await result
        if isinstance(result, str):
            emit.done(CustomHarnessDone(output=result, session_id=context.session_id))
        elif isinstance(result, CustomHarnessDone):
            emit.done(result)
    except Exception as error:
        emit.error(error, {"session_id": context.session_id or ""})
        raise
