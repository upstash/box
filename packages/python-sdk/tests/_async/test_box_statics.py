"""Static methods: list, delete_boxes, delete_snapshots, env management."""

import json

import httpx
import pytest
import respx
from helpers import TEST_API_KEY, TEST_BASE_URL, TEST_BOX_DATA

from upstash_box import AsyncBox, BoxError

ROOT = f"{TEST_BASE_URL}/v2/box"


def _opts():
    return {"api_key": TEST_API_KEY, "base_url": TEST_BASE_URL}


@respx.mock
async def test_list_boxes():
    respx.get(ROOT).mock(return_value=httpx.Response(200, json=[TEST_BOX_DATA]))
    boxes = await AsyncBox.list(**_opts())
    assert boxes[0].id == "box-123"


@respx.mock
async def test_list_boxes_with_label():
    route = respx.get(ROOT).mock(return_value=httpx.Response(200, json=[TEST_BOX_DATA]))
    await AsyncBox.list(label="beta", **_opts())
    assert route.calls.last.request.url.params["label"] == "beta"


@respx.mock
async def test_delete_boxes():
    route = respx.delete(ROOT).mock(return_value=httpx.Response(200, json={}))
    await AsyncBox.delete_boxes(box_ids="box-123", **_opts())
    assert json.loads(route.calls.last.request.content) == {"ids": ["box-123"]}


@respx.mock
async def test_delete_snapshots_all():
    route = respx.delete(f"{ROOT}/snapshots").mock(
        return_value=httpx.Response(200, json={"deleted": 3})
    )
    result = await AsyncBox.delete_snapshots(**_opts())
    assert result["deleted"] == 3
    assert json.loads(route.calls.last.request.content) == {}


@respx.mock
async def test_delete_snapshots_specific():
    route = respx.delete(f"{ROOT}/snapshots").mock(
        return_value=httpx.Response(200, json={"deleted": 1})
    )
    await AsyncBox.delete_snapshots(snapshot_ids="snap-1", **_opts())
    assert json.loads(route.calls.last.request.content) == {"ids": ["snap-1"]}


@respx.mock
async def test_env_set_list_delete_set_all():
    set_route = respx.put(f"{ROOT}/settings/env/KEY").mock(
        return_value=httpx.Response(200, json={})
    )
    respx.get(f"{ROOT}/settings/env").mock(
        return_value=httpx.Response(200, json={"env_vars": {"KEY": "***"}})
    )
    respx.delete(f"{ROOT}/settings/env/KEY").mock(return_value=httpx.Response(200, json={}))
    set_all_route = respx.put(f"{ROOT}/settings/env").mock(
        return_value=httpx.Response(200, json={})
    )

    await AsyncBox.set_env("KEY", "value", **_opts())
    assert json.loads(set_route.calls.last.request.content) == {"value": "value"}
    env = await AsyncBox.list_env(**_opts())
    assert env == {"KEY": "***"}
    await AsyncBox.delete_env("KEY", **_opts())
    await AsyncBox.set_all_env({"A": "1"}, **_opts())
    assert json.loads(set_all_route.calls.last.request.content) == {"env_vars": {"A": "1"}}


async def test_list_requires_api_key(monkeypatch):
    monkeypatch.delenv("UPSTASH_BOX_API_KEY", raising=False)
    with pytest.raises(BoxError, match="api_key is required"):
        await AsyncBox.list(base_url=TEST_BASE_URL)
