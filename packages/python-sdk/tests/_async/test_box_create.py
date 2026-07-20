import httpx
import pytest
import respx
from helpers import TEST_API_KEY, TEST_BASE_URL, TEST_BOX_DATA, last_json_body

from upstash_box import Agent, AsyncBox, BoxApiKey, BoxError

CREATE_URL = f"{TEST_BASE_URL}/v2/box"


def _opts():
    return {"api_key": TEST_API_KEY, "base_url": TEST_BASE_URL}


@respx.mock
async def test_create_basic():
    route = respx.post(CREATE_URL).mock(return_value=httpx.Response(200, json=TEST_BOX_DATA))
    box = await AsyncBox.create(
        runtime="node",
        agent={"harness": Agent.CLAUDE_CODE, "model": "anthropic/claude-sonnet-4-5"},
        **_opts(),
    )
    assert box.id == "box-123"
    body = last_json_body(route)
    assert body["runtime"] == "node"
    assert body["agent"] == "claude-code"
    assert body["model"] == "anthropic/claude-sonnet-4-5"
    await box.aclose()


@respx.mock
async def test_create_with_labels():
    route = respx.post(CREATE_URL).mock(return_value=httpx.Response(200, json=TEST_BOX_DATA))
    box = await AsyncBox.create(
        labels=["beta", "x-team"],
        agent={"harness": Agent.CLAUDE_CODE, "model": "anthropic/claude-sonnet-4-5"},
        **_opts(),
    )
    assert last_json_body(route)["labels"] == ["beta", "x-team"]
    await box.aclose()


@respx.mock
async def test_create_with_managed_key_and_options():
    route = respx.post(CREATE_URL).mock(return_value=httpx.Response(200, json=TEST_BOX_DATA))
    box = await AsyncBox.create(
        size="large",
        keep_alive=True,
        init_command="npm run dev",
        agent={
            "harness": Agent.CLAUDE_CODE,
            "model": "anthropic/claude-sonnet-4-5",
            "api_key": BoxApiKey.UPSTASH_KEY,
        },
        git={"token": "ght", "user_name": "Jane", "user_email": "jane@example.com"},
        env={"NODE_ENV": "production"},
        skills=["upstash/workflow-js"],
        mcp_servers=[{"name": "fs", "package": "@mcp/fs"}],
        network_policy={"mode": "deny-all"},
        **_opts(),
    )
    body = last_json_body(route)
    assert body["size"] == "large"
    assert body["keep_alive"] is True
    assert body["init_command"] == "npm run dev"
    assert body["agent_api_key"] == "UPSTASH_KEY"
    assert body["github_token"] == "ght"
    assert body["git_user_name"] == "Jane"
    assert body["env_vars"] == {"NODE_ENV": "production"}
    assert body["skills"] == ["upstash/workflow-js"]
    assert body["mcp_servers"][0]["source"] == "npm"
    assert body["network_policy"] == {"mode": "deny-all"}
    await box.aclose()


@respx.mock
async def test_create_polls_until_ready():
    creating = {**TEST_BOX_DATA, "status": "creating"}
    respx.post(CREATE_URL).mock(return_value=httpx.Response(200, json=creating))
    respx.get(f"{CREATE_URL}/box-123").mock(return_value=httpx.Response(200, json=TEST_BOX_DATA))
    box = await AsyncBox.create(
        agent={"harness": Agent.CLAUDE_CODE, "model": "anthropic/claude-sonnet-4-5"},
        **_opts(),
    )
    assert box.id == "box-123"
    await box.aclose()


@respx.mock
async def test_create_error_status_raises():
    respx.post(CREATE_URL).mock(
        return_value=httpx.Response(200, json={**TEST_BOX_DATA, "status": "error"})
    )
    with pytest.raises(BoxError, match="Box creation failed"):
        await AsyncBox.create(
            agent={"harness": Agent.CLAUDE_CODE, "model": "anthropic/claude-sonnet-4-5"},
            **_opts(),
        )


async def test_create_requires_api_key(monkeypatch):
    monkeypatch.delenv("UPSTASH_BOX_API_KEY", raising=False)
    with pytest.raises(BoxError, match="api_key is required"):
        await AsyncBox.create(base_url=TEST_BASE_URL)


async def test_init_command_requires_keep_alive():
    with pytest.raises(BoxError, match="init_command requires keep_alive"):
        await AsyncBox.create(init_command="x", **_opts())


@respx.mock
async def test_create_non_ok_raises():
    respx.post(CREATE_URL).mock(return_value=httpx.Response(400, json={"error": "bad config"}))
    with pytest.raises(BoxError, match="bad config"):
        await AsyncBox.create(**_opts())
