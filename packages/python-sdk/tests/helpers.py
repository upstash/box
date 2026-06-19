"""Shared test helpers — respx-based httpx mocking, SSE builders, and box
factories. respx intercepts at the httpx transport layer, so these cover both
the async (`AsyncBox`) and sync (`Box`) clients from one place.
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

import httpx
import respx

from upstash_box import AsyncBox, Box

TEST_API_KEY = "test-api-key"
TEST_BASE_URL = "https://test.api.example.com"

TEST_BOX_DATA: Dict[str, Any] = {
    "id": "box-123",
    "model": "anthropic/claude-sonnet-4-5",
    "agent": "claude-code",
    "runtime": "node",
    "status": "running",
    "created_at": 1672531200,
    "updated_at": 1672531200,
    "network_policy": {"mode": "allow-all"},
}


class _ChunkStream(httpx.SyncByteStream, httpx.AsyncByteStream):
    """A byte stream that yields a fixed list of byte chunks for both sync and
    async iteration — lets one mocked response drive either client."""

    def __init__(self, chunks: List[bytes]) -> None:
        self._chunks = chunks

    def __iter__(self):
        yield from self._chunks

    async def __aiter__(self):
        for chunk in self._chunks:
            yield chunk


def _sse_text(events: List[Dict[str, Any]]) -> str:
    return "".join(f"event: {e['event']}\ndata: {json.dumps(e['data'])}\n\n" for e in events)


def sse_response(events: List[Dict[str, Any]]) -> httpx.Response:
    """A single-chunk SSE response."""
    body = _sse_text(events).encode()
    return httpx.Response(
        200,
        headers={"content-type": "text/event-stream"},
        stream=_ChunkStream([body]),
    )


def sse_response_chunked(events: List[Dict[str, Any]]) -> httpx.Response:
    """An SSE response where each event is its own byte chunk (for early-break /
    backpressure tests)."""
    chunks = [f"event: {e['event']}\ndata: {json.dumps(e['data'])}\n\n".encode() for e in events]
    return httpx.Response(
        200,
        headers={"content-type": "text/event-stream"},
        stream=_ChunkStream(chunks),
    )


def raw_stream_response(chunks: List[bytes]) -> httpx.Response:
    """A streaming response from explicit raw byte chunks (exec-stream tests)."""
    return httpx.Response(
        200,
        headers={"content-type": "text/event-stream"},
        stream=_ChunkStream(chunks),
    )


def mock_get_box(
    router: respx.Router, overrides: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    data = {**TEST_BOX_DATA, **(overrides or {})}
    router.get(f"{TEST_BASE_URL}/v2/box/{data['id']}").mock(
        return_value=httpx.Response(200, json=data)
    )
    return data


async def make_async_box(
    router: respx.Router, overrides: Optional[Dict[str, Any]] = None
) -> AsyncBox:
    data = mock_get_box(router, overrides)
    return await AsyncBox.get(data["id"], api_key=TEST_API_KEY, base_url=TEST_BASE_URL)


def make_sync_box(router: respx.Router, overrides: Optional[Dict[str, Any]] = None) -> Box:
    data = mock_get_box(router, overrides)
    return Box.get(data["id"], api_key=TEST_API_KEY, base_url=TEST_BASE_URL)


def last_json_body(route: Any) -> Dict[str, Any]:
    return json.loads(route.calls.last.request.content)
