"""Golden-file equality: feed one fixed byte stream through both the async and
the generated sync SSE parsers and assert identical results. Catches unasync
substitution bugs in the streaming parsers."""

import asyncio

import httpx

from upstash_box._async import _sse as async_sse
from upstash_box._sync import _sse as sync_sse

# A messy stream: split across odd chunk boundaries, ANSI noise, a leading
# spinner char, all run-stream event types, then exec-stream markers.
RUN_CHUNKS = [
    b'event: run_start\ndata: {"run_id": "r1"}\n\n',
    b'\x1b[2Kevent: text\ndata: {"text": "He',
    b'llo"}\n\nevent: thinking\nda',
    b'ta: {"text": "trace"}\n\n',
    b'event: tool\ndata: {"id": "t1", "name": "Read", "input": {}}\n\n',
    b'event: done\ndata: {"output": "Hello", "input_tokens": 2}\n\n',
]

EXEC_CHUNKS = [b"out", b"put", b"event: ex", b'it\ndata: {"exit_code": 0, "cpu_ns": 9}\n\n']


def _response(chunks):
    class _Stream(httpx.SyncByteStream, httpx.AsyncByteStream):
        def __iter__(self):
            yield from chunks

        async def __aiter__(self):
            for c in chunks:
                yield c

    return httpx.Response(200, stream=_Stream())


def _sync_run_events():
    return list(sync_sse.iter_sse_events(_response(RUN_CHUNKS)))


def _async_run_events():
    async def collect():
        return [e async for e in async_sse.iter_sse_events(_response(RUN_CHUNKS))]

    return asyncio.run(collect())


def test_run_stream_parsers_match():
    assert _sync_run_events() == _async_run_events()


def _sync_exec_chunks():
    return list(sync_sse.iter_exec_stream(_response(EXEC_CHUNKS)))


def _async_exec_chunks():
    async def collect():
        return [c async for c in async_sse.iter_exec_stream(_response(EXEC_CHUNKS))]

    return asyncio.run(collect())


def test_exec_stream_parsers_match():
    assert _sync_exec_chunks() == _async_exec_chunks()


def test_run_stream_content():
    events = _sync_run_events()
    types = [e[0] for e in events]
    assert types == ["run_start", "text", "thinking", "tool", "done"]
