from unittest.mock import Mock

import httpx
import pytest
import respx
from helpers import TEST_API_KEY, TEST_BASE_URL, TEST_BOX_DATA, make_sync_box

from upstash_box import Box


@pytest.mark.parametrize("operation", ["create", "from_snapshot", "snapshot"])
@pytest.mark.parametrize("poll_count", [0, 10])
@respx.mock
def test_readiness_polling_backoff(operation, poll_count, monkeypatch):
    sleep = Mock()
    monkeypatch.setattr("upstash_box._sync.client.time.sleep", sleep)
    opts = {"api_key": TEST_API_KEY, "base_url": TEST_BASE_URL}
    box = None

    if operation == "snapshot":
        box = make_sync_box(respx.mock)
        ready = {
            "id": "snap-1",
            "name": "checkpoint",
            "box_id": box.id,
            "status": "ready",
            "size_bytes": 100,
            "created_at": 1,
        }
        post_url = get_url = f"{TEST_BASE_URL}/v2/box/{box.id}/snapshots"
    else:
        ready = TEST_BOX_DATA
        post_url = f"{TEST_BASE_URL}/v2/box"
        if operation == "from_snapshot":
            post_url += "/from-snapshot"
        get_url = f"{TEST_BASE_URL}/v2/box/{ready['id']}"

    creating = {**ready, "status": "creating"}
    respx.post(post_url).mock(
        return_value=httpx.Response(200, json=creating if poll_count else ready)
    )
    if poll_count:
        responses = [creating] * (poll_count - 1) + [ready]
        respx.get(get_url).mock(
            side_effect=[
                httpx.Response(200, json={"snapshots": [data]} if operation == "snapshot" else data)
                for data in responses
            ]
        )

    try:
        if operation == "snapshot":
            result = box.snapshot(name="checkpoint")
            assert result.status == "ready"
        elif operation == "from_snapshot":
            box = Box.from_snapshot("snap-1", **opts)
        else:
            box = Box.create(**opts)

        expected = [0.1, 0.15, 0.225, 0.3375, 0.50625, 0.759375, 1.1390625, 1.70859375, 2.0, 2.0]
        assert [call.args[0] for call in sleep.call_args_list] == pytest.approx(
            expected[:poll_count]
        )
    finally:
        if box is not None:
            box.close()
