"""Async exec.session handle, driven against a scripted local WebSocket server.

The protocol helpers are pure and tested directly; everything else runs through
a real socket so the pump task, exit settling, and teardown are exercised rather
than mocked.
"""

import asyncio
import json

import pytest
from exec_session_server import replies, start_replies
from websockets.asyncio.server import serve

from upstash_box import BoxError
from upstash_box._exec_session import (
    build_start_frame,
    normalize_signal,
    open_async_exec_session,
    session_url,
)

_HANDSHAKE_FAILURES = ("__error__", "__exit__", "__close__")


@pytest.fixture
async def ws_url():
    async def handler(ws):
        start = json.loads(await ws.recv())
        for frame in start_replies(start):
            await ws.send(json.dumps(frame))
        if start.get("cmd") in _HANDSHAKE_FAILURES:
            await ws.close()
            return
        async for raw in ws:
            for frame in replies(json.loads(raw)):
                await ws.send(json.dumps(frame))

    server = await serve(handler, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    try:
        yield f"ws://127.0.0.1:{port}"
    finally:
        server.close()


class Collector:
    def __init__(self) -> None:
        self.out: list[bytes] = []
        self.err: list[bytes] = []
        self._arrived = asyncio.Event()

    def on_stdout(self, data: bytes) -> None:
        self.out.append(data)
        self._arrived.set()

    def on_stderr(self, data: bytes) -> None:
        self.err.append(data)
        self._arrived.set()

    async def next_chunk(self) -> None:
        await asyncio.wait_for(self._arrived.wait(), 5)
        self._arrived.clear()


async def open_session(url, *, cmd="run", collector=None, **overrides):
    fields = {
        "argv": None,
        "tty": False,
        "cwd": "/workspace/home",
        "rows": None,
        "cols": None,
        "env": None,
    }
    fields.update(overrides)
    return await open_async_exec_session(
        url=url,
        headers={},
        timeout_s=5,
        start=build_start_frame(cmd=cmd, **fields),
        on_stdout=collector.on_stdout if collector else None,
        on_stderr=collector.on_stderr if collector else None,
    )


# ==================== Protocol helpers ====================


def test_start_frame_argv_takes_precedence_over_cmd():
    frame = build_start_frame(
        cmd="echo hi",
        argv=["/bin/echo", "hi"],
        tty=True,
        cwd="/workspace/home/sub",
        rows=24,
        cols=80,
        env=["A=1"],
    )
    assert frame == {
        "type": "start",
        "argv": ["/bin/echo", "hi"],
        "tty": True,
        "cwd": "/workspace/home/sub",
        "rows": 24,
        "cols": 80,
        "env": ["A=1"],
    }
    assert "cmd" not in frame


def test_start_frame_omits_unset_optionals():
    frame = build_start_frame(
        cmd="echo hi", argv=None, tty=False, cwd="/workspace/home", rows=None, cols=None, env=None
    )
    assert frame == {"type": "start", "cmd": "echo hi", "cwd": "/workspace/home"}


def test_start_frame_requires_cmd_or_argv():
    with pytest.raises(BoxError, match="requires cmd or argv"):
        build_start_frame(
            cmd=None, argv=[], tty=False, cwd="/workspace/home", rows=None, cols=None, env=None
        )


@pytest.mark.parametrize(
    ("given", "expected"),
    [(None, "TERM"), ("int", "INT"), ("SIGKILL", "KILL"), ("  sigusr1 ", "USR1")],
)
def test_normalize_signal_accepts_aliases(given, expected):
    assert normalize_signal(given) == expected


@pytest.mark.parametrize("bad", ["STOP", "SIGSTOP", "9", ""])
def test_normalize_signal_rejects_unsupported(bad):
    with pytest.raises(BoxError, match="unsupported signal"):
        normalize_signal(bad)


def test_session_url_switches_scheme():
    assert (
        session_url("https://box.upstash.io", "box-1")
        == "wss://box.upstash.io/v2/box/box-1/exec-session"
    )
    assert (
        session_url("http://localhost:8080", "box-1")
        == "ws://localhost:8080/v2/box/box-1/exec-session"
    )


# ==================== Handshake ====================


async def test_handshake_exposes_pid_and_exec_id(ws_url):
    handle = await open_session(ws_url)
    try:
        assert handle.pid == 4242
        assert handle.exec_id == "exec-abc"
    finally:
        await handle.close()


async def test_start_frame_reaches_the_server_verbatim(ws_url):
    collector = Collector()
    handle = await open_session(
        ws_url,
        cmd=None,
        argv=["sleep", "1"],
        tty=True,
        rows=30,
        cols=120,
        env=["X=1"],
        collector=collector,
    )
    try:
        await collector.next_chunk()
        assert json.loads(collector.out[0]) == {
            "type": "start",
            "argv": ["sleep", "1"],
            "cwd": "/workspace/home",
            "env": ["X=1"],
            "cols": 120,
            "rows": 30,
            "tty": True,
        }
    finally:
        await handle.close()


async def test_handshake_error_frame_raises(ws_url):
    with pytest.raises(BoxError, match="boom"):
        await open_session(ws_url, cmd="__error__")


async def test_handshake_exit_before_start_raises(ws_url):
    with pytest.raises(BoxError, match="exited before start"):
        await open_session(ws_url, cmd="__exit__")


async def test_handshake_close_before_start_raises(ws_url):
    with pytest.raises(BoxError, match="closed before start"):
        await open_session(ws_url, cmd="__close__")


async def test_connection_failure_raises(ws_url):
    with pytest.raises(BoxError, match="connection failed"):
        await open_async_exec_session(
            url="ws://127.0.0.1:1",
            headers={},
            timeout_s=5,
            start={"type": "start", "cmd": "x", "cwd": "/"},
        )


# ==================== Live session ====================


async def test_write_reaches_stdin_and_output_is_decoded(ws_url):
    collector = Collector()
    handle = await open_session(ws_url, collector=collector)
    try:
        await collector.next_chunk()  # start echo
        await handle.write("hello ")
        await collector.next_chunk()
        await handle.write(b"bytes")
        await collector.next_chunk()
        assert collector.out[1:] == [b"hello ", b"bytes"]
    finally:
        await handle.close()


async def test_end_stdin_drains_stderr_then_exits_zero(ws_url):
    collector = Collector()
    handle = await open_session(ws_url, collector=collector)
    await handle.end_stdin()
    assert await handle.wait() == 0
    assert collector.err == [b"eof"]


async def test_kill_sends_normalized_signal(ws_url):
    collector = Collector()
    handle = await open_session(ws_url, collector=collector)
    await handle.kill("SIGINT")
    assert await handle.wait() == 130
    assert collector.out[-1] == b"sig:INT"


async def test_kill_defaults_to_term(ws_url):
    collector = Collector()
    handle = await open_session(ws_url, collector=collector)
    await handle.kill()
    await handle.wait()
    assert collector.out[-1] == b"sig:TERM"


async def test_kill_rejects_unsupported_signal_without_sending(ws_url):
    handle = await open_session(ws_url)
    try:
        with pytest.raises(BoxError, match="unsupported signal"):
            await handle.kill("SIGSTOP")
    finally:
        await handle.close()


async def test_terminate_carries_grace_ms(ws_url):
    collector = Collector()
    handle = await open_session(ws_url, collector=collector)
    await handle.terminate(2500)
    assert await handle.wait() == 143
    assert collector.out[-1] == b"term:2500"


async def test_terminate_omits_non_positive_grace(ws_url):
    collector = Collector()
    handle = await open_session(ws_url, collector=collector)
    await handle.terminate(0)
    await handle.wait()
    assert collector.out[-1] == b"term:0"


async def test_resize_sends_dimensions(ws_url):
    collector = Collector()
    handle = await open_session(ws_url, tty=True, collector=collector)
    try:
        await collector.next_chunk()
        await handle.resize(40, 100)
        await collector.next_chunk()
        assert collector.out[-1] == b"size:40x100"
    finally:
        await handle.close()


async def test_writes_after_exit_are_silent_no_ops(ws_url):
    collector = Collector()
    handle = await open_session(ws_url, collector=collector)
    await handle.end_stdin()
    assert await handle.wait() == 0
    seen = len(collector.out)
    await handle.write("ignored")
    await handle.end_stdin()
    await handle.resize(1, 1)
    await handle.terminate()
    await asyncio.sleep(0.05)
    assert len(collector.out) == seen


async def test_close_settles_wait_as_forced_teardown(ws_url):
    handle = await open_session(ws_url)
    await handle.close()
    assert await handle.wait() == -1


async def test_wait_is_repeatable(ws_url):
    handle = await open_session(ws_url)
    await handle.end_stdin()
    assert await handle.wait() == 0
    assert await handle.wait() == 0


async def test_context_manager_closes_the_session(ws_url):
    async with await open_session(ws_url) as handle:
        assert handle.pid == 4242
    assert await handle.wait() == -1


async def test_async_callbacks_are_awaited(ws_url):
    received: list[bytes] = []
    done = asyncio.Event()

    async def on_stdout(data: bytes) -> None:
        await asyncio.sleep(0)
        received.append(data)
        done.set()

    handle = await open_async_exec_session(
        url=ws_url,
        headers={},
        timeout_s=5,
        start=build_start_frame(
            cmd="run", argv=None, tty=False, cwd="/workspace/home", rows=None, cols=None, env=None
        ),
        on_stdout=on_stdout,
    )
    try:
        await asyncio.wait_for(done.wait(), 5)
        assert json.loads(received[0])["type"] == "start"
    finally:
        await handle.close()
