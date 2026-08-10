"""Handwritten sync suite — exercises the GENERATED sync ``Box`` directly, with
emphasis on the unasync risk areas (streaming, early-break/detached, cancel,
failed-partial-output, multipart, polling). Not generated from the async tests.
"""

import httpx
import pytest
import respx
from helpers import (
    TEST_API_KEY,
    TEST_BASE_URL,
    TEST_BOX_DATA,
    last_json_body,
    make_sync_box,
    raw_stream_response,
    sse_response,
    sse_response_chunked,
)
from pydantic import BaseModel

from upstash_box import Box, BoxError

BASE = f"{TEST_BASE_URL}/v2/box/box-123"
RUN_URL = f"{BASE}/run/stream"


def _opts():
    return {"api_key": TEST_API_KEY, "base_url": TEST_BASE_URL}


# ---------- create / lifecycle ----------


@respx.mock
def test_create_and_transport_close():
    respx.post(f"{TEST_BASE_URL}/v2/box").mock(return_value=httpx.Response(200, json=TEST_BOX_DATA))
    box = Box.create(
        agent={"harness": "claude-code", "model": "anthropic/claude-sonnet-4-5"}, **_opts()
    )
    assert box.id == "box-123"
    with box:
        assert box._client.is_closed is False
    assert box._client.is_closed is True


@respx.mock
def test_create_polls_until_ready():
    creating = {**TEST_BOX_DATA, "status": "creating"}
    respx.post(f"{TEST_BASE_URL}/v2/box").mock(return_value=httpx.Response(200, json=creating))
    # The polling loop uses time.sleep in the generated sync client.
    respx.get(f"{TEST_BASE_URL}/v2/box/box-123").mock(
        return_value=httpx.Response(200, json=TEST_BOX_DATA)
    )
    box = Box.create(agent={"harness": "claude-code", "model": "m"}, **_opts())
    assert box.id == "box-123"
    box.close()


# ---------- agent run / stream ----------


@respx.mock
def test_agent_run_streams_text():
    box = make_sync_box(respx.mock)
    respx.post(RUN_URL).mock(
        return_value=sse_response(
            [
                {"event": "run_start", "data": {"run_id": "r1"}},
                {"event": "text", "data": {"text": "Hello "}},
                {"event": "text", "data": {"text": "world"}},
                {"event": "done", "data": {"input_tokens": 3, "output_tokens": 4}},
            ]
        )
    )
    run = box.agent.run(prompt="hi")
    assert run.result == "Hello world"
    assert run.status == "completed"
    assert run.cost.input_tokens == 3
    box.close()


@respx.mock
def test_agent_run_structured_output_pydantic():
    box = make_sync_box(respx.mock)
    respx.post(RUN_URL).mock(
        return_value=sse_response(
            [
                {"event": "run_start", "data": {"run_id": "r1"}},
                {"event": "done", "data": {"output": '{"name":"x","count":1}'}},
            ]
        )
    )

    class M(BaseModel):
        name: str
        count: int

    run = box.agent.run(prompt="x", response_schema=M)
    assert run.result == M(name="x", count=1)
    box.close()


@respx.mock
def test_stream_yields_chunks_in_order():
    box = make_sync_box(respx.mock)
    respx.post(RUN_URL).mock(
        return_value=sse_response(
            [
                {"event": "run_start", "data": {"run_id": "r1"}},
                {"event": "text", "data": {"text": "hi"}},
                {"event": "tool", "data": {"id": "t1", "name": "Read", "input": {}}},
                {"event": "done", "data": {"output": "hi"}},
            ]
        )
    )
    stream = box.agent.stream(prompt="x")
    types = [c.type for c in stream]
    assert types == ["start", "text-delta", "tool-call", "finish"]
    assert stream.result == "hi"
    box.close()


@respx.mock
def test_stream_detached_on_early_break():
    box = make_sync_box(respx.mock)
    respx.post(RUN_URL).mock(
        return_value=sse_response_chunked(
            [
                {"event": "run_start", "data": {"run_id": "r1"}},
                {"event": "text", "data": {"text": "Hello "}},
                {"event": "text", "data": {"text": "world"}},
                {"event": "done", "data": {"output": "Hello world"}},
            ]
        )
    )
    stream = box.agent.stream(prompt="x")
    for chunk in stream:
        if chunk.type == "text-delta":
            break
    stream.close()
    assert stream.status == "detached"
    assert stream.result == "Hello"
    box.close()


@respx.mock
def test_stream_failed_preserves_partial():
    box = make_sync_box(respx.mock)
    respx.post(RUN_URL).mock(
        return_value=sse_response_chunked(
            [
                {"event": "run_start", "data": {"run_id": "r1"}},
                {"event": "text", "data": {"text": "partial"}},
                {"event": "error", "data": {"error": "boom"}},
            ]
        )
    )
    stream = box.agent.stream(prompt="x")
    with pytest.raises(BoxError, match="boom"):
        for _ in stream:
            pass
    assert stream.status == "failed"
    assert stream.result == "partial"
    box.close()


@respx.mock
def test_run_cancel_swallows_errors():
    box = make_sync_box(respx.mock)
    respx.post(RUN_URL).mock(
        return_value=sse_response(
            [
                {"event": "run_start", "data": {"run_id": "r1"}},
                {"event": "done", "data": {"output": "ok"}},
            ]
        )
    )
    run = box.agent.run(prompt="x")
    respx.post(f"{BASE}/runs/r1/cancel").mock(
        return_value=httpx.Response(500, json={"error": "no"})
    )
    run.cancel()
    assert run.status == "cancelled"
    box.close()


# ---------- exec stream (marker split) ----------


@respx.mock
def test_exec_stream_marker_split():
    box = make_sync_box(respx.mock)
    chunks = [b"out", b"put", b"event: ex", b'it\ndata: {"exit_code": 0}\n\n']
    respx.post(f"{BASE}/exec-stream").mock(return_value=raw_stream_response(chunks))
    stream = box.exec.stream("x")
    collected = list(stream)
    outputs = "".join(c.data for c in collected if c.type == "output")
    assert outputs == "output"
    assert any(c.type == "exit" for c in collected)
    assert stream.status == "completed"
    box.close()


# ---------- multipart upload ----------


@respx.mock
def test_files_upload_multipart(tmp_path):
    box = make_sync_box(respx.mock)
    local = tmp_path / "f.txt"
    local.write_text("data")
    route = respx.post(f"{BASE}/files/upload").mock(return_value=httpx.Response(200, json={}))
    box.files.upload([{"path": str(local), "destination": "remote.txt"}])
    assert route.calls.last.request.headers["content-type"].startswith("multipart/form-data")
    box.close()


# ---------- exec / files happy paths ----------


@respx.mock
def test_exec_command_and_files():
    box = make_sync_box(respx.mock)
    respx.post(f"{BASE}/exec").mock(
        return_value=httpx.Response(200, json={"exit_code": 0, "output": "ok"})
    )
    respx.post(f"{BASE}/files/write").mock(return_value=httpx.Response(200, json={}))
    respx.get(url__startswith=f"{BASE}/files/read").mock(
        return_value=httpx.Response(200, json={"content": "ok"})
    )
    assert box.exec.command("echo ok").result == "ok"
    box.files.write(path="a.txt", content="ok")
    assert box.files.read("a.txt") == "ok"
    box.close()


@respx.mock
def test_claude_code_agent_options_snake_to_camel():
    box = make_sync_box(respx.mock, {"agent": "claude-code"})
    route = respx.post(RUN_URL).mock(
        return_value=sse_response(
            [
                {"event": "run_start", "data": {"run_id": "r1"}},
                {"event": "done", "data": {"output": "ok"}},
            ]
        )
    )
    # Public snake_case options -> camelCase on the wire for Claude Code.
    box.agent.run(prompt="x", options={"max_turns": 5})
    assert last_json_body(route)["agent_options"] == {"maxTurns": 5}
    box.close()


@respx.mock
def test_codex_agent_options_snake_passthrough():
    box = make_sync_box(respx.mock, {"agent": "codex"})
    route = respx.post(RUN_URL).mock(
        return_value=sse_response(
            [
                {"event": "run_start", "data": {"run_id": "r1"}},
                {"event": "done", "data": {"output": "ok"}},
            ]
        )
    )
    # Codex backend uses snake_case (pass-through).
    box.agent.run(prompt="x", options={"model_reasoning_effort": "high"})
    assert last_json_body(route)["agent_options"] == {"model_reasoning_effort": "high"}
    box.close()


# ---------- browser (generated-sync smoke) ----------


@respx.mock
def test_browser_tab_flow_sync():
    box = make_sync_box(respx.mock)
    create = respx.post(f"{BASE}/browser/tabs").mock(
        return_value=httpx.Response(200, json={"id": "tab-1", "url": "https://example.com"})
    )
    respx.get(f"{BASE}/browser/content", params={"tab": "tab-1"}).mock(
        return_value=httpx.Response(
            200, json={"title": "Example", "url": "https://example.com", "text": "Example"}
        )
    )
    respx.get(f"{BASE}/browser/recordings/rec-1").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "rec-1",
                "box_id": "box-123",
                "status": "completed",
                "started_at": 1000,
                "expires_at": 1_209_601,
                "stopped_reason": "idle",
            },
        )
    )

    tab = box.browser.tab.create("https://example.com", wait_until="load")
    content = tab.content()
    recording = box.browser.recordings.get("rec-1")

    assert tab.id == "tab-1"
    assert content.title == "Example"
    assert last_json_body(create) == {"url": "https://example.com", "wait_until": "load"}
    # seconds -> ms normalization survives sync generation
    assert recording.expires_at == 1_209_601_000
    box.close()


@respx.mock
def test_recording_download_sync(tmp_path):
    box = make_sync_box(respx.mock)
    respx.get(f"{BASE}/browser/recordings/rec-1/download").mock(
        return_value=httpx.Response(
            200, content=b"mp4-bytes", headers={"content-type": "video/mp4"}
        )
    )

    # Parent directories are created as needed.
    dest = box.browser.recordings.download("rec-1", path=str(tmp_path / "nested" / "demo.mp4"))

    assert dest == str(tmp_path / "nested" / "demo.mp4")
    with open(dest, "rb") as fh:
        assert fh.read() == b"mp4-bytes"
    box.close()


@respx.mock
def test_recording_download_sync_legacy_ts(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    box = make_sync_box(respx.mock)
    respx.get(f"{BASE}/browser/recordings/rec-1/download").mock(
        return_value=httpx.Response(
            200, content=b"ts-bytes", headers={"content-type": "video/mp2t"}
        )
    )

    # Legacy recordings without an MP4 remux stream raw MPEG-TS.
    dest = box.browser.recordings.download("rec-1")

    assert dest == "./box-recording-rec-1.ts"
    with open(dest, "rb") as fh:
        assert fh.read() == b"ts-bytes"
    box.close()
