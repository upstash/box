"""Sync exec.session handle. Hand-written (the sync handle is hand-written too,
not generated), driven against the same scripted server as the async suite so
the two flavors are held to identical wire behavior.
"""

import json
import threading

import pytest
from exec_session_server import replies, start_replies
from websockets.sync.server import serve

from upstash_box import BoxError
from upstash_box._exec_session import build_start_frame, open_exec_session

_HANDSHAKE_FAILURES = (
    "__error__",
    "__exit__",
    "__close__",
    "__zero_pid__",
    "__no_pid__",
)


@pytest.fixture
def ws_url():
    def handler(ws):
        start = json.loads(ws.recv())
        for frame in start_replies(start):
            ws.send(json.dumps(frame))
        if start.get("cmd") in _HANDSHAKE_FAILURES:
            ws.close()
            return
        for raw in ws:
            for frame in replies(json.loads(raw)):
                ws.send(json.dumps(frame))

    server = serve(handler, "127.0.0.1", 0)
    port = server.socket.getsockname()[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"ws://127.0.0.1:{port}"
    finally:
        server.shutdown()
        thread.join(timeout=5)


class Collector:
    def __init__(self) -> None:
        self.out: list[bytes] = []
        self.err: list[bytes] = []
        self._arrived = threading.Event()

    def on_stdout(self, data: bytes) -> None:
        self.out.append(data)
        self._arrived.set()

    def on_stderr(self, data: bytes) -> None:
        self.err.append(data)
        self._arrived.set()

    def next_chunk(self) -> None:
        assert self._arrived.wait(5), "no output arrived"
        self._arrived.clear()


def open_session(url, *, cmd="run", collector=None, **overrides):
    fields = {
        "argv": None,
        "tty": False,
        "cwd": "/workspace/home",
        "rows": None,
        "cols": None,
        "env": None,
    }
    fields.update(overrides)
    return open_exec_session(
        url=url,
        headers={},
        timeout_s=5,
        start=build_start_frame(cmd=cmd, **fields),
        on_stdout=collector.on_stdout if collector else None,
        on_stderr=collector.on_stderr if collector else None,
    )


def test_handshake_exposes_pid_and_exec_id(ws_url):
    handle = open_session(ws_url)
    try:
        assert handle.pid == 4242
        assert handle.exec_id == "exec-abc"
    finally:
        handle.close()


def test_start_frame_reaches_the_server_verbatim(ws_url):
    collector = Collector()
    handle = open_session(
        ws_url, cmd=None, argv=["sleep", "1"], tty=True, rows=30, cols=120, collector=collector
    )
    try:
        collector.next_chunk()
        assert json.loads(collector.out[0]) == {
            "type": "start",
            "argv": ["sleep", "1"],
            "cwd": "/workspace/home",
            "cols": 120,
            "rows": 30,
            "tty": True,
        }
    finally:
        handle.close()


@pytest.mark.parametrize("mode", ["__zero_pid__", "__no_pid__"])
def test_started_without_a_usable_pid_raises(ws_url, mode):
    # A handle whose kill()/terminate() cannot reach the process is worse
    # than no handle, so the handshake fails instead.
    with pytest.raises(BoxError, match="without a usable pid"):
        open_session(ws_url, cmd=mode)


def test_handshake_error_frame_raises(ws_url):
    with pytest.raises(BoxError, match="boom"):
        open_session(ws_url, cmd="__error__")


def test_error_frame_after_start_ends_wait_and_hangs_up(ws_url):
    handle = open_session(ws_url, cmd="__late_error__")
    assert handle.wait(5) == -1
    # Once wait() has settled the caller considers the session over, so the
    # client hangs up rather than leaving the process alive behind a live socket.
    handle._reader.join(timeout=5)
    assert handle._conn.protocol.state.name == "CLOSED"


def test_handshake_close_before_start_raises(ws_url):
    with pytest.raises(BoxError, match="closed before start"):
        open_session(ws_url, cmd="__close__")


def test_connection_failure_raises():
    with pytest.raises(BoxError, match="connection failed"):
        open_exec_session(
            url="ws://127.0.0.1:1",
            headers={},
            timeout_s=5,
            start={"type": "start", "cmd": "x", "cwd": "/"},
        )


def test_write_reaches_stdin_and_output_is_decoded(ws_url):
    collector = Collector()
    handle = open_session(ws_url, collector=collector)
    try:
        collector.next_chunk()  # start echo
        handle.write("hello ")
        collector.next_chunk()
        handle.write(b"bytes")
        collector.next_chunk()
        assert collector.out[1:] == [b"hello ", b"bytes"]
    finally:
        handle.close()


def test_end_stdin_drains_stderr_then_exits_zero(ws_url):
    collector = Collector()
    handle = open_session(ws_url, collector=collector)
    handle.end_stdin()
    assert handle.wait(5) == 0
    assert collector.err == [b"eof"]


def test_kill_sends_normalized_signal(ws_url):
    collector = Collector()
    handle = open_session(ws_url, collector=collector)
    handle.kill("SIGINT")
    assert handle.wait(5) == 130
    assert collector.out[-1] == b"sig:INT"


def test_kill_rejects_unsupported_signal_without_sending(ws_url):
    handle = open_session(ws_url)
    try:
        with pytest.raises(BoxError, match="unsupported signal"):
            handle.kill("SIGSTOP")
    finally:
        handle.close()


def test_terminate_carries_grace_ms(ws_url):
    collector = Collector()
    handle = open_session(ws_url, collector=collector)
    handle.terminate(2500)
    assert handle.wait(5) == 143
    assert collector.out[-1] == b"term:2500"


def test_resize_sends_dimensions(ws_url):
    collector = Collector()
    handle = open_session(ws_url, tty=True, collector=collector)
    try:
        collector.next_chunk()
        handle.resize(40, 100)
        collector.next_chunk()
        assert collector.out[-1] == b"size:40x100"
    finally:
        handle.close()


def test_wait_times_out_while_the_process_runs(ws_url):
    handle = open_session(ws_url)
    try:
        with pytest.raises(TimeoutError):
            handle.wait(0.2)
    finally:
        handle.close()


def test_close_settles_wait_as_forced_teardown(ws_url):
    handle = open_session(ws_url)
    handle.close()
    assert handle.wait(5) == -1


def test_context_manager_closes_the_session(ws_url):
    with open_session(ws_url) as handle:
        assert handle.pid == 4242
    assert handle.wait(5) == -1
