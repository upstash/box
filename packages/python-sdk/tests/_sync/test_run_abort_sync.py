"""Sync counterparts of tests/_async/test_run_abort.py for the generated client:
a run ``timeout`` is a total limit, cancel stops the stream, and an aborted run
is never retried."""

import json
import time

import httpx
import pytest
import respx
from helpers import TEST_BASE_URL, make_sync_box

from upstash_box import Box, BoxError

RUN_URL = f"{TEST_BASE_URL}/v2/box/box-123/run/stream"
CANCEL_URL = f"{TEST_BASE_URL}/v2/box/box-123/runs/r1/cancel"


def _sse(event: str, data: dict) -> bytes:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n".encode()


class _SlowStream(httpx.SyncByteStream):
    def __init__(self, count: int, gap: float) -> None:
        self.count = count
        self.gap = gap

    def __iter__(self):
        yield _sse("run_start", {"run_id": "r1"})
        for i in range(self.count):
            time.sleep(self.gap)
            yield _sse("text", {"text": f"{i} "})
        yield _sse("done", {"output": "finished"})


def _slow_response(count: int, gap: float) -> httpx.Response:
    return httpx.Response(
        200, headers={"content-type": "text/event-stream"}, stream=_SlowStream(count, gap)
    )


@respx.mock
def test_timed_out_run_is_not_retried():
    box = make_sync_box(respx.mock)
    route = respx.post(RUN_URL).mock(side_effect=httpx.ReadTimeout("read timed out"))

    with pytest.raises(BoxError, match="Run timed out"):
        box.agent.run(prompt="slow", timeout=1000, max_retries=3)

    assert route.call_count == 1
    box.close()


@respx.mock
def test_run_timeout_is_a_total_deadline_while_events_keep_flowing():
    box = make_sync_box(respx.mock)
    respx.post(RUN_URL).mock(return_value=_slow_response(count=20, gap=0.05))

    started = time.monotonic()
    with pytest.raises(BoxError, match="Run timed out"):
        box.agent.run(prompt="long", timeout=200)

    assert time.monotonic() - started < 0.6
    box.close()


@respx.mock
def test_stream_timeout_marks_the_run_cancelled():
    box = make_sync_box(respx.mock)
    respx.post(RUN_URL).mock(return_value=_slow_response(count=20, gap=0.05))

    stream = box.agent.stream(prompt="long", timeout=200)
    with pytest.raises(BoxError, match="Stream timed out"):
        for _chunk in stream:
            pass

    assert stream.status == "cancelled"
    box.close()


@respx.mock
def test_cancel_stops_the_stream():
    box = make_sync_box(respx.mock)
    respx.post(RUN_URL).mock(return_value=_slow_response(count=10, gap=0.01))
    cancel_route = respx.post(CANCEL_URL).mock(return_value=httpx.Response(200, json={}))

    stream = box.agent.stream(prompt="long job")
    received = 0
    with pytest.raises(BoxError, match="cancelled"):
        for _chunk in stream:
            received += 1
            if received == 2:
                stream.cancel()

    assert received == 2
    assert stream.status == "cancelled"
    assert cancel_route.call_count == 1
    box.close()


@respx.mock
def test_transport_timeout_without_run_timeout_is_a_box_error():
    box = make_sync_box(respx.mock)
    respx.post(RUN_URL).mock(side_effect=httpx.ReadTimeout("read timed out"))

    with pytest.raises(BoxError, match="Request timeout"):
        box.agent.run(prompt="slow")
    box.close()


@respx.mock
def test_expired_stream_never_submits_a_run():
    box = make_sync_box(respx.mock)
    route = respx.post(RUN_URL).mock(return_value=_slow_response(count=0, gap=0))

    stream = box.agent.stream(prompt="late", timeout=20)
    time.sleep(0.05)
    with pytest.raises(BoxError, match="Stream timed out"):
        for _chunk in stream:
            pass

    assert route.call_count == 0
    box.close()


@respx.mock
def test_response_opened_after_the_deadline_is_a_timeout():
    # The sync client cannot interrupt the open, but it must not use a response
    # that arrived after the deadline.
    def slow_open(_request):
        time.sleep(0.1)
        return _slow_response(count=1, gap=0)

    box = make_sync_box(respx.mock)
    route = respx.post(RUN_URL).mock(side_effect=slow_open)

    with pytest.raises(BoxError, match="Run timed out"):
        box.agent.run(prompt="slow open", timeout=50, max_retries=2)

    assert route.call_count == 1
    box.close()


@respx.mock
def test_transport_failure_after_the_deadline_is_a_timeout_and_not_retried():
    def slow_failure(request):
        time.sleep(0.1)
        raise httpx.RemoteProtocolError("Server disconnected", request=request)

    box = make_sync_box(respx.mock)
    route = respx.post(RUN_URL).mock(side_effect=slow_failure)

    with pytest.raises(BoxError, match="Run timed out"):
        box.agent.run(prompt="slow open", timeout=50, max_retries=2)

    assert route.call_count == 1
    box.close()


def _slow_request_build(monkeypatch):
    """Simulate a slow attachment read while the run request is being built."""
    original = Box._build_run_stream_request

    def slow(self, *args):
        time.sleep(0.05)
        return original(self, *args)

    monkeypatch.setattr(Box, "_build_run_stream_request", slow)


@respx.mock
def test_slow_request_build_past_the_deadline_never_submits_a_run(monkeypatch):
    _slow_request_build(monkeypatch)
    box = make_sync_box(respx.mock)
    route = respx.post(RUN_URL).mock(return_value=_slow_response(count=0, gap=0))

    with pytest.raises(BoxError, match="Run timed out"):
        box.agent.run(prompt="with attachments", timeout=20)

    assert route.call_count == 0
    box.close()


@respx.mock
def test_slow_request_build_past_the_deadline_never_submits_a_stream(monkeypatch):
    _slow_request_build(monkeypatch)
    box = make_sync_box(respx.mock)
    route = respx.post(RUN_URL).mock(return_value=_slow_response(count=0, gap=0))

    stream = box.agent.stream(prompt="with attachments", timeout=20)
    with pytest.raises(BoxError, match="Stream timed out"):
        for _chunk in stream:
            pass

    assert route.call_count == 0
    box.close()


class _LateBody(httpx.SyncByteStream):
    """Delivers ``body`` (possibly empty) only after ``delay`` seconds."""

    def __init__(self, body: bytes, delay: float) -> None:
        self.body = body
        self.delay = delay

    def __iter__(self):
        time.sleep(self.delay)
        if self.body:
            yield self.body


@respx.mock
def test_cancel_before_first_iteration_never_submits_a_run():
    box = make_sync_box(respx.mock)
    route = respx.post(RUN_URL).mock(return_value=_slow_response(count=0, gap=0))
    respx.route(method="POST", path__regex=r".*/cancel$").mock(
        return_value=httpx.Response(200, json={})
    )

    stream = box.agent.stream(prompt="never mind")
    stream.cancel()
    with pytest.raises(BoxError, match="Run cancelled"):
        for _chunk in stream:
            pass

    assert route.call_count == 0
    box.close()


@respx.mock
def test_api_error_body_arriving_after_the_deadline_is_a_timeout_and_not_retried():
    box = make_sync_box(respx.mock)
    route = respx.post(RUN_URL).mock(
        return_value=httpx.Response(500, stream=_LateBody(b'{"error": "boom"}', 0.1))
    )

    with pytest.raises(BoxError, match="Run timed out"):
        box.agent.run(prompt="p", timeout=50, max_retries=2)

    assert route.call_count == 1
    box.close()


@respx.mock
def test_api_error_before_the_deadline_keeps_its_message():
    box = make_sync_box(respx.mock)
    respx.post(RUN_URL).mock(return_value=httpx.Response(500, json={"error": "boom"}))

    with pytest.raises(BoxError, match="boom"):
        box.agent.run(prompt="p", timeout=5000)
    box.close()


@respx.mock
def test_eof_after_the_deadline_is_a_timeout_not_completion():
    box = make_sync_box(respx.mock)
    respx.post(RUN_URL).mock(
        return_value=httpx.Response(
            200, headers={"content-type": "text/event-stream"}, stream=_LateBody(b"", 0.1)
        )
    )

    stream = box.agent.stream(prompt="p", timeout=50)
    with pytest.raises(BoxError, match="Stream timed out"):
        for _chunk in stream:
            pass

    assert stream.status == "cancelled"
    box.close()
