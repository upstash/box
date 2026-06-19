import httpx
import respx
from helpers import TEST_BASE_URL, make_async_box


@respx.mock
async def test_properties_from_box_data():
    box = await make_async_box(respx.mock, {"size": "large", "keep_alive": True})
    assert box.id == "box-123"
    assert box.size == "large"
    assert box.keep_alive is True
    assert box.cwd == "/workspace/home"
    assert box.network_policy == {"mode": "allow-all"}
    await box.aclose()


@respx.mock
async def test_model_config_shape():
    box = await make_async_box(respx.mock)
    assert box.model_config == {"harness": "claude-code", "model": "anthropic/claude-sonnet-4-5"}
    await box.aclose()


@respx.mock
async def test_cd_updates_cwd():
    box = await make_async_box(respx.mock)
    respx.post(f"{TEST_BASE_URL}/v2/box/box-123/exec").mock(
        return_value=httpx.Response(200, json={"exit_code": 0, "output": ""})
    )
    await box.cd("my-project")
    assert box.cwd == "/workspace/home/my-project"
    await box.cd("..")
    assert box.cwd == "/workspace/home"
    await box.aclose()


@respx.mock
async def test_cd_missing_dir_raises():
    import pytest

    from upstash_box import BoxError

    box = await make_async_box(respx.mock)
    respx.post(f"{TEST_BASE_URL}/v2/box/box-123/exec").mock(
        return_value=httpx.Response(200, json={"exit_code": 1, "output": ""})
    )
    with pytest.raises(BoxError, match="No such file or directory"):
        await box.cd("nope")
    await box.aclose()


@respx.mock
async def test_context_manager_closes_transport():
    box = await make_async_box(respx.mock)
    async with box:
        assert box._client.is_closed is False
    assert box._client.is_closed is True


@respx.mock
async def test_aclose_closes_transport():
    box = await make_async_box(respx.mock)
    await box.aclose()
    assert box._client.is_closed is True


@respx.mock
async def test_delete_closes_transport():
    box = await make_async_box(respx.mock)
    respx.delete(f"{TEST_BASE_URL}/v2/box/box-123").mock(return_value=httpx.Response(200, json={}))
    await box.delete()
    assert box._client.is_closed is True
