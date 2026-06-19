"""Async SSE parsers for the run-stream and exec/code-stream endpoints.

Generation-safe: this module is the source of truth and is transformed into
``upstash_box/_sync/_sse.py`` by ``scripts/generate_sync.py`` (``aiter_bytes`` ->
``iter_bytes``, ``async for`` -> ``for``, etc.). Keep substitutions mechanical.
"""

from __future__ import annotations

import codecs
import json
import re
from typing import Any, AsyncIterator, List, Tuple

import httpx

from ..errors import BoxError
from ..types import ExecExitChunk, ExecOutputChunk, ExecStreamChunk

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
_SPINNER_RE = re.compile(r"^[\\|/\-\s]*")

_EXEC_EVENT_PREFIXES = ("event: exit\n", "event: error\n")


async def iter_sse_events(response: httpx.Response) -> AsyncIterator[Tuple[str, str]]:
    """Yield ``(event_type, data)`` pairs from a Box SSE run-stream response.

    Mirrors the JS parser: strips ANSI escapes and leading spinner characters,
    and flushes a trailing event when the buffer drains.
    """
    decoder = codecs.getincrementaldecoder("utf-8")("replace")
    buffer = ""
    event_type = ""
    event_data = ""

    async for value in response.aiter_bytes():
        chunk = _ANSI_RE.sub("", decoder.decode(value))
        buffer += chunk

        lines = buffer.split("\n")
        buffer = lines.pop() if lines else ""

        for line in lines:
            line = line.rstrip("\r")
            line = _SPINNER_RE.sub("", line)
            if line.startswith("event: "):
                event_type = line[7:].strip()
            elif line.startswith("data: "):
                event_data = line[6:]
            elif line.strip() == "" and event_type and event_data:
                yield (event_type, event_data)
                event_type = ""
                event_data = ""

        if event_type and event_data and buffer.strip() == "":
            yield (event_type, event_data)
            event_type = ""
            event_data = ""

    if event_type and event_data:
        yield (event_type, event_data)


def _safe_exec_output_length(buffer: str) -> int:
    max_prefix = max(len(p) for p in _EXEC_EVENT_PREFIXES)
    max_suffix = min(len(buffer), max_prefix - 1)
    for length in range(max_suffix, 0, -1):
        suffix = buffer[-length:]
        if any(p.startswith(suffix) for p in _EXEC_EVENT_PREFIXES):
            return len(buffer) - length
    return len(buffer)


def _parse_exit_data(after: str) -> ExecExitChunk:
    match = re.search(r"^data:\s*(.+)", after, re.MULTILINE)
    if match:
        try:
            parsed = json.loads(match.group(1))
            return ExecExitChunk(
                exit_code=parsed.get("exit_code", 0), cpu_ns=parsed.get("cpu_ns", 0)
            )
        except Exception:
            return ExecExitChunk(exit_code=0, cpu_ns=0)
    return ExecExitChunk(exit_code=0, cpu_ns=0)


def _raise_exec_error(after: str) -> None:
    match = re.search(r"^data:\s*(.+)", after, re.MULTILINE)
    if match:
        try:
            parsed = json.loads(match.group(1))
        except Exception:
            raise BoxError("Stream error") from None
        raise BoxError(parsed.get("error") or "Stream error")
    raise BoxError("Stream error")


def _flush_exec_buffer(buffer: str) -> List[ExecStreamChunk]:
    err_idx = buffer.find("event: error\n")
    if err_idx != -1:
        _raise_exec_error(buffer[err_idx + len("event: error\n") :])

    exit_idx = buffer.find("event: exit\n")
    out: List[ExecStreamChunk] = []
    if exit_idx != -1:
        if exit_idx > 0:
            out.append(ExecOutputChunk(data=buffer[:exit_idx]))
        out.append(_parse_exit_data(buffer[exit_idx + len("event: exit\n") :]))
    else:
        out.append(ExecOutputChunk(data=buffer))
    return out


async def iter_exec_stream(response: httpx.Response) -> AsyncIterator[ExecStreamChunk]:
    """Yield ``ExecStreamChunk`` values from an exec/code-stream response."""
    decoder = codecs.getincrementaldecoder("utf-8")("replace")
    buffer = ""

    async for value in response.aiter_bytes():
        buffer += decoder.decode(value)

        err_idx = buffer.find("event: error\n")
        if err_idx != -1:
            _raise_exec_error(buffer[err_idx + len("event: error\n") :])

        exit_idx = buffer.find("event: exit\n")
        if exit_idx == -1:
            out_len = _safe_exec_output_length(buffer)
            if out_len > 0:
                yield ExecOutputChunk(data=buffer[:out_len])
                buffer = buffer[out_len:]
            continue

        if exit_idx > 0:
            yield ExecOutputChunk(data=buffer[:exit_idx])
        yield _parse_exit_data(buffer[exit_idx + len("event: exit\n") :])
        return

    if buffer:
        for chunk in _flush_exec_buffer(buffer):
            yield chunk


def parse_done_data(data: Any) -> dict:  # pragma: no cover - trivial passthrough
    return data
