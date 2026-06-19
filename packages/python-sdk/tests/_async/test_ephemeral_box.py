import json

import httpx
import respx
from helpers import TEST_API_KEY, TEST_BASE_URL, TEST_BOX_DATA

from upstash_box import AsyncBox, AsyncEphemeralBox

ROOT = f"{TEST_BASE_URL}/v2/box"


def _opts():
    return {"api_key": TEST_API_KEY, "base_url": TEST_BASE_URL}


def _ephemeral_data(**over):
    return {**TEST_BOX_DATA, "ephemeral": True, "expires_at": 9999, **over}


@respx.mock
async def test_create_ephemeral():
    route = respx.post(ROOT).mock(return_value=httpx.Response(200, json=_ephemeral_data()))
    box = await AsyncEphemeralBox.create(runtime="node", ttl=3600, **_opts())
    assert box.id == "box-123"
    assert box.expires_at == 9999
    body = json.loads(route.calls.last.request.content)
    assert body["ephemeral"] is True
    assert body["ttl"] == 3600
    await box.aclose()


@respx.mock
async def test_ephemeral_exec_and_files_namespaces_present():
    respx.post(ROOT).mock(return_value=httpx.Response(200, json=_ephemeral_data()))
    box = await AsyncEphemeralBox.create(**_opts())
    assert hasattr(box, "exec")
    assert hasattr(box, "files")
    assert hasattr(box, "schedule")
    # No agent / git / skills on ephemeral.
    assert not hasattr(box, "agent")
    assert not hasattr(box, "git")
    assert not hasattr(box, "skills")
    await box.aclose()


@respx.mock
async def test_ephemeral_get_by_name_returns_box():
    respx.get(f"{ROOT}/my-box").mock(return_value=httpx.Response(200, json=TEST_BOX_DATA))
    result = await AsyncEphemeralBox.get_by_name("my-box", **_opts())
    # Mirrors JS quirk: returns a full Box, not an EphemeralBox.
    assert isinstance(result, AsyncBox)
    await result.aclose()


@respx.mock
async def test_ephemeral_from_snapshot():
    respx.post(f"{ROOT}/from-snapshot").mock(
        return_value=httpx.Response(200, json=_ephemeral_data())
    )
    box = await AsyncEphemeralBox.from_snapshot("snap-1", ttl=1800, **_opts())
    assert box.expires_at == 9999
    await box.aclose()
