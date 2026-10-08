"""Run timeouts, cancellation, and retries — mirrors the abort tests in the JS
SDK's box-agent-run.test.ts. A run ``timeout`` is a total wall-clock limit, and a
cancelled or timed-out run is never retried, because the run may still be
executing server-side and a retry would start a second billed run."""

import asyncio
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx
import pytest
import respx
from helpers import TEST_BASE_URL, make_async_box, sse_response

from upstash_box import AsyncBox, BoxError

RUN_URL = f"{TEST_BASE_URL}/v2/box/box-123/run/stream"
CANCEL_URL = f"{TEST_BASE_URL}/v2/box/box-123/runs/r1/cancel"


def _sse(event: str, data: dict) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n".encode()


class _SlowStream(httpx.AsyncByteStream):
    """Emits a text event every ``gap`` seconds, then a done event."""

    def __init__(self, count: int, gap: float) -> None:
        self.count = count
        self.gap = gap

    async def __aiter__(self):
        yield _sse("run_start", {"run_id": "r1"})
        for i in range(self.count):
            await asyncio.sleep(self.gap)
            yield _sse("text", {"text": f"{i} "})
        yield _sse("done", {"output": "finished"})


def _slow_response(count: int, gap: float) -> httpx.Response:
    return httpx.Response(
        200, headers={"content-type": "text/event-stream"}, stream=_SlowStream(count, gap)
    )


# ---------- retries ----------


@respx.mock
async def test_timed_out_run_is_not_retried():
    box = await make_async_box(respx.mock)
    route = respx.post(RUN_URL).mock(side_effect=httpx.ReadTimeout("read timed out"))

    with pytest.raises(BoxError, match="Run timed out"):
        await box.agent.run(prompt="slow", timeout=1000, max_retries=3)

    assert route.call_count == 1
    await box.aclose()


@respx.mock
async def test_ordinary_failure_is_still_retried(monkeypatch):
    async def no_sleep(_seconds):
        return None

    monkeypatch.setattr(asyncio, "sleep", no_sleep)
    box = await make_async_box(respx.mock)
    route = respx.post(RUN_URL).mock(
        side_effect=[
            httpx.ConnectError("socket hang up"),
            sse_response([{"event": "done", "data": {"output": "second try"}}]),
        ]
    )

    run = await box.agent.run(prompt="flaky", max_retries=1)

    assert route.call_count == 2
    assert run.status == "completed"
    assert run.result == "second try"
    await box.aclose()


@respx.mock
async def test_transport_timeout_without_run_timeout_is_a_box_error():
    box = await make_async_box(respx.mock)
    respx.post(RUN_URL).mock(side_effect=httpx.ReadTimeout("read timed out"))

    with pytest.raises(BoxError, match="Request timeout"):
        await box.agent.run(prompt="slow")
    await box.aclose()


# ---------- timeout is a total deadline ----------


@respx.mock
async def test_run_timeout_is_a_total_deadline_while_events_keep_flowing():
    # Every gap is shorter than the timeout, so a per-read timeout never fires.
    box = await make_async_box(respx.mock)
    respx.post(RUN_URL).mock(return_value=_slow_response(count=20, gap=0.05))

    started = time.monotonic()
    with pytest.raises(BoxError, match="Run timed out"):
        await box.agent.run(prompt="long", timeout=200)

    assert time.monotonic() - started < 0.6
    await box.aclose()


@respx.mock
async def test_stream_timeout_marks_the_run_cancelled():
    box = await make_async_box(respx.mock)
    respx.post(RUN_URL).mock(return_value=_slow_response(count=20, gap=0.05))

    stream = await box.agent.stream(prompt="long", timeout=200)
    with pytest.raises(BoxError, match="Stream timed out"):
        async for _chunk in stream:
            pass

    assert stream.status == "cancelled"
    await box.aclose()


@respx.mock
async def test_zero_timeout_means_no_deadline():
    box = await make_async_box(respx.mock)
    respx.post(RUN_URL).mock(return_value=_slow_response(count=2, gap=0.01))

    run = await box.agent.run(prompt="quick", timeout=0)

    assert run.status == "completed"
    await box.aclose()


# ---------- cancel ----------


@respx.mock
async def test_cancel_stops_the_stream_and_reports_an_abort_not_a_timeout():
    box = await make_async_box(respx.mock)
    respx.post(RUN_URL).mock(return_value=_slow_response(count=10, gap=0.01))
    cancel_route = respx.post(CANCEL_URL).mock(return_value=httpx.Response(200, json={}))

    stream = await box.agent.stream(prompt="long job")
    received = 0
    with pytest.raises(BoxError) as excinfo:
        async for _chunk in stream:
            received += 1
            if received == 2:
                await stream.cancel()

    assert "timed out" not in str(excinfo.value)
    assert "cancelled" in str(excinfo.value)
    assert received == 2
    assert stream.status == "cancelled"
    assert cancel_route.call_count == 1
    await box.aclose()


@respx.mock
async def test_cancel_then_break_keeps_cancelled_status():
    box = await make_async_box(respx.mock)
    respx.post(RUN_URL).mock(return_value=_slow_response(count=10, gap=0.01))
    respx.post(CANCEL_URL).mock(return_value=httpx.Response(200, json={}))

    stream = await box.agent.stream(prompt="long job")
    async for _chunk in stream:
        await stream.cancel()
        break
    await stream.aclose()

    assert stream.status == "cancelled"
    await box.aclose()


# ---------- real socket: the read timeout shrinks to the time left ----------


class _GoesSilentHandler(BaseHTTPRequestHandler):
    """Sends three events 0.3s apart, then holds the connection open silently."""

    def do_POST(self):  # noqa: N802
        self.rfile.read(int(self.headers.get("content-length", 0)))
        self.send_response(200)
        self.send_header("content-type", "text/event-stream")
        self.end_headers()
        for i in range(3):
            self.wfile.write(_sse("text", {"text": str(i)}))
            self.wfile.flush()
            time.sleep(0.3)
        time.sleep(3)

    def log_message(self, *_args):
        pass


@pytest.fixture
def silent_server():
    server = ThreadingHTTPServer(("127.0.0.1", 0), _GoesSilentHandler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()


async def test_silent_stream_times_out_at_the_deadline_not_a_full_timeout_later(silent_server):
    # Without shrinking, the last read would wait a full second after the
    # third event (~1.6s total). With it, the run stops at its 1s deadline.
    data = {
        "id": "box-123",
        "model": "anthropic/claude-sonnet-4-5",
        "agent": "claude-code",
        "status": "idle",
        "created_at": 0,
        "updated_at": 0,
    }
    box = AsyncBox(
        data,
        {
            "base_url": silent_server,
            "headers": {},
            "timeout": 600000,
            "debug": False,
            "is_agent_configured": True,
            "client": httpx.AsyncClient(),
        },
    )

    started = time.monotonic()
    with pytest.raises(BoxError, match="Run timed out"):
        await box.agent.run(prompt="hangs", timeout=1000)
    elapsed = time.monotonic() - started

    assert 0.9 < elapsed < 1.3
    await box.aclose()


# ---------- the deadline also bounds submitting and opening the run ----------


@respx.mock
async def test_expired_stream_never_submits_a_run():
    # The deadline starts at stream(); the request is sent on first iteration.
    box = await make_async_box(respx.mock)
    route = respx.post(RUN_URL).mock(
        return_value=sse_response([{"event": "done", "data": {"output": "x"}}])
    )

    stream = await box.agent.stream(prompt="late", timeout=20)
    await asyncio.sleep(0.05)
    with pytest.raises(BoxError, match="Stream timed out"):
        async for _chunk in stream:
            pass

    assert route.call_count == 0
    assert stream.status == "cancelled"
    await box.aclose()


class _SlowHeadersHandler(BaseHTTPRequestHandler):
    """Sends the status line, then one header line every 60ms for ~1.8s."""

    def do_POST(self):  # noqa: N802
        self.rfile.read(int(self.headers.get("content-length", 0)))
        self.wfile.write(b"HTTP/1.1 200 OK\r\n")
        self.wfile.flush()
        for i in range(30):
            time.sleep(0.06)
            self.wfile.write(f"X-Slow-{i}: v\r\n".encode())
            self.wfile.flush()

    def log_message(self, *_args):
        pass


@pytest.fixture
def slow_headers_server():
    server = ThreadingHTTPServer(("127.0.0.1", 0), _SlowHeadersHandler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()


def _box_at(base_url: str) -> AsyncBox:
    data = {
        "id": "box-123",
        "model": "anthropic/claude-sonnet-4-5",
        "agent": "claude-code",
        "status": "idle",
        "created_at": 0,
        "updated_at": 0,
    }
    return AsyncBox(
        data,
        {
            "base_url": base_url,
            "headers": {},
            "timeout": 600000,
            "debug": False,
            "is_agent_configured": True,
            "client": httpx.AsyncClient(),
        },
    )


async def test_run_deadline_bounds_a_slowly_opening_response(slow_headers_server):
    # Each header fragment resets httpx's per-read timeout, so only the run
    # deadline can stop this.
    box = _box_at(slow_headers_server)

    started = time.monotonic()
    with pytest.raises(BoxError, match="Run timed out"):
        await box.agent.run(prompt="slow open", timeout=100, max_retries=2)

    assert time.monotonic() - started < 0.5
    await box.aclose()


async def test_stream_deadline_bounds_a_slowly_opening_response(slow_headers_server):
    box = _box_at(slow_headers_server)

    stream = await box.agent.stream(prompt="slow open", timeout=100)
    started = time.monotonic()
    with pytest.raises(BoxError, match="Stream timed out"):
        async for _chunk in stream:
            pass

    assert time.monotonic() - started < 0.5
    assert stream.status == "cancelled"
    await box.aclose()


# ---------- cancel and timeout edge cases ----------


@respx.mock
async def test_cancel_before_first_iteration_never_submits_a_run():
    # StreamRun is lazy, so cancel() can run before the request is sent.
    box = await make_async_box(respx.mock)
    route = respx.post(RUN_URL).mock(
        return_value=sse_response([{"event": "done", "data": {"output": "x"}}])
    )
    respx.route(method="POST", path__regex=r".*/cancel$").mock(
        return_value=httpx.Response(200, json={})
    )

    stream = await box.agent.stream(prompt="never mind")
    await stream.cancel()
    with pytest.raises(BoxError, match="Run cancelled"):
        async for _chunk in stream:
            pass

    assert route.call_count == 0
    assert stream.status == "cancelled"
    await box.aclose()


@respx.mock
async def test_zero_timeout_sends_no_httpx_timeout():
    box = await make_async_box(respx.mock)
    route = respx.post(RUN_URL).mock(
        return_value=sse_response([{"event": "done", "data": {"output": "x"}}])
    )

    await box.agent.run(prompt="no limit", timeout=0)

    sent = route.calls.last.request.extensions["timeout"]
    assert sent == {"connect": None, "read": None, "write": None, "pool": None}
    await box.aclose()


@respx.mock
async def test_cancel_wins_over_a_deadline_that_passes_while_suspended():
    box = await make_async_box(respx.mock)
    respx.post(RUN_URL).mock(return_value=_slow_response(count=5, gap=0.01))
    respx.post(CANCEL_URL).mock(return_value=httpx.Response(200, json={}))

    stream = await box.agent.stream(prompt="long job", timeout=100)
    with pytest.raises(BoxError, match="Run cancelled"):
        async for _chunk in stream:
            await stream.cancel()
            await asyncio.sleep(0.15)  # resume only after the deadline

    assert stream.status == "cancelled"
    await box.aclose()
