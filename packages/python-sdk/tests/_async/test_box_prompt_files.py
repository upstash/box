"""agent.run / agent.stream with prompt file attachments — the three wire modes:
local file paths (multipart), base64 objects (JSON), and webhook + files."""

import json

import httpx
import respx
from helpers import TEST_BASE_URL, make_async_box, sse_response

RUN_URL = f"{TEST_BASE_URL}/v2/box/box-123/run/stream"
WEBHOOK_URL = f"{TEST_BASE_URL}/v2/box/box-123/run"

DONE = sse_response(
    [
        {"event": "run_start", "data": {"run_id": "r1"}},
        {"event": "done", "data": {"output": "ok"}},
    ]
)


def _done():
    return sse_response(
        [
            {"event": "run_start", "data": {"run_id": "r1"}},
            {"event": "done", "data": {"output": "ok"}},
        ]
    )


@respx.mock
async def test_run_with_local_file_paths_is_multipart(tmp_path):
    box = await make_async_box(respx.mock)
    img = tmp_path / "shot.png"
    img.write_bytes(b"\x89PNG\r\n")
    route = respx.post(RUN_URL).mock(return_value=_done())

    await box.agent.run(prompt="describe", files=[str(img)])

    req = route.calls.last.request
    assert req.headers["content-type"].startswith("multipart/form-data")
    body = req.content
    # The prompt scalar field and the file part are both present.
    assert b'name="prompt"' in body
    assert b"describe" in body
    assert b"shot.png" in body
    assert b"\x89PNG" in body
    await box.aclose()


@respx.mock
async def test_run_with_base64_files_is_json(tmp_path):
    box = await make_async_box(respx.mock)
    route = respx.post(RUN_URL).mock(return_value=_done())

    await box.agent.run(
        prompt="describe",
        files=[{"data": "aW1n", "media_type": "image/png", "filename": "x.png"}],
    )

    req = route.calls.last.request
    assert req.headers["content-type"].startswith("application/json")
    body = json.loads(req.content)
    assert body["prompt"] == "describe"
    assert body["files"] == [{"data": "aW1n", "media_type": "image/png", "filename": "x.png"}]
    await box.aclose()


@respx.mock
async def test_stream_with_local_file_paths_is_multipart(tmp_path):
    box = await make_async_box(respx.mock)
    doc = tmp_path / "report.pdf"
    doc.write_bytes(b"%PDF-1.4")
    route = respx.post(RUN_URL).mock(return_value=_done())

    stream = await box.agent.stream(prompt="summarize", files=[str(doc)])
    async for _ in stream:
        pass

    req = route.calls.last.request
    assert req.headers["content-type"].startswith("multipart/form-data")
    assert b"report.pdf" in req.content
    assert b"%PDF-1.4" in req.content
    await box.aclose()


@respx.mock
async def test_webhook_run_with_base64_files(tmp_path):
    box = await make_async_box(respx.mock)
    route = respx.post(WEBHOOK_URL).mock(
        return_value=httpx.Response(200, json={"status": "accepted", "run_id": "wh-1"})
    )

    run = await box.agent.run(
        prompt="analyze",
        files=[{"data": "ZGF0YQ==", "media_type": "application/pdf"}],
        webhook={"url": "https://example.com/hook"},
    )

    assert run.id == "wh-1"
    body = json.loads(route.calls.last.request.content)
    assert body["webhook"] == {"url": "https://example.com/hook"}
    assert body["files"][0]["media_type"] == "application/pdf"
    await box.aclose()


@respx.mock
async def test_webhook_run_with_local_file_paths_is_multipart(tmp_path):
    box = await make_async_box(respx.mock)
    f = tmp_path / "a.txt"
    f.write_text("hello")
    route = respx.post(WEBHOOK_URL).mock(
        return_value=httpx.Response(200, json={"status": "accepted", "run_id": "wh-2"})
    )

    await box.agent.run(
        prompt="read it",
        files=[str(f)],
        webhook={"url": "https://example.com/hook"},
    )

    req = route.calls.last.request
    assert req.headers["content-type"].startswith("multipart/form-data")
    assert b"a.txt" in req.content
    # webhook config travels as a JSON-encoded form field in multipart mode.
    assert b'name="webhook"' in req.content
    await box.aclose()
