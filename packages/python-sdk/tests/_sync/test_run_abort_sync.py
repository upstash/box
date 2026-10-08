"""Sync counterparts of tests/_async/test_run_abort.py for the generated client:
a run ``timeout`` is a total limit, cancel stops the stream, and an aborted run
is never retried."""

import json
import time

import httpx
import pytest
import respx
from helpers import TEST_BASE_URL, make_sync_box

from upstash_box import BoxError

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
