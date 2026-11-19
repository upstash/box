import httpx
import respx
from helpers import TEST_API_KEY, TEST_BASE_URL, TEST_BOX_DATA, make_async_box

from upstash_box import AsyncBox

BASE = f"{TEST_BASE_URL}/v2/box/box-123"


def _snap(**over):
    base = {
        "id": "snap-1",
        "name": "cp1",
        "box_id": "box-123",
        "size_bytes": 100,
        "status": "ready",
        "created_at": 1,
    }
    base.update(over)
    return base


@respx.mock
async def test_snapshot_ready_immediately():
    box = await make_async_box(respx.mock)
    respx.post(f"{BASE}/snapshots").mock(return_value=httpx.Response(200, json=_snap()))
    snap = await box.snapshot(name="cp1")
    assert snap.id == "snap-1"
    assert snap.status == "ready"
    await box.aclose()


@respx.mock
async def test_snapshot_polls_until_ready():
    box = await make_async_box(respx.mock)
    respx.post(f"{BASE}/snapshots").mock(
        return_value=httpx.Response(200, json=_snap(status="creating"))
    )
    respx.get(f"{BASE}/snapshots").mock(
        return_value=httpx.Response(200, json={"snapshots": [_snap(status="ready")]})
    )
    snap = await box.snapshot(name="cp1")
    assert snap.status == "ready"
    await box.aclose()


@respx.mock
async def test_list_and_delete_snapshot():
    box = await make_async_box(respx.mock)
    respx.get(f"{BASE}/snapshots").mock(
        return_value=httpx.Response(200, json={"snapshots": [_snap()]})
    )
    respx.delete(f"{BASE}/snapshots/snap-1").mock(return_value=httpx.Response(200, json={}))
    snaps = await box.list_snapshots()
    assert snaps[0].id == "snap-1"
    await box.delete_snapshot("snap-1")
    await box.aclose()


@respx.mock
async def test_from_snapshot():
    route = respx.post(f"{TEST_BASE_URL}/v2/box/from-snapshot").mock(
        return_value=httpx.Response(200, json=TEST_BOX_DATA)
    )
    box = await AsyncBox.from_snapshot(
        "snap-1", size="medium", api_key=TEST_API_KEY, base_url=TEST_BASE_URL
    )
    assert box.id == "box-123"
    import json

    body = json.loads(route.calls.last.request.content)
    assert body["snapshot_id"] == "snap-1"
    assert body["size"] == "medium"
    await box.aclose()


@respx.mock
async def test_from_snapshot_with_labels():
    import json

    route = respx.post(f"{TEST_BASE_URL}/v2/box/from-snapshot").mock(
        return_value=httpx.Response(200, json=TEST_BOX_DATA)
    )
    box = await AsyncBox.from_snapshot(
        "snap-1", labels=["beta", "x-team"], api_key=TEST_API_KEY, base_url=TEST_BASE_URL
    )
    body = json.loads(route.calls.last.request.content)
    assert body["labels"] == ["beta", "x-team"]
    await box.aclose()
