import httpx
import pytest
import respx
from helpers import TEST_BASE_URL, last_json_body, make_async_box

from upstash_box import BoxError

BASE = f"{TEST_BASE_URL}/v2/box/box-123"


@respx.mock
async def test_clone_includes_git_token():
    box = await make_async_box(respx.mock)
    box._git_token = "ght"
    route = respx.post(f"{BASE}/git/clone").mock(return_value=httpx.Response(200, json={}))
    await box.git.clone(repo="https://github.com/u/r", branch="main")
    body = last_json_body(route)
    assert body["repo"] == "https://github.com/u/r"
    assert body["branch"] == "main"
    assert body["github_token"] == "ght"
    await box.aclose()


@respx.mock
async def test_diff_and_status():
    box = await make_async_box(respx.mock)
    respx.get(url__startswith=f"{BASE}/git/diff").mock(
        return_value=httpx.Response(200, json={"diff": "D"})
    )
    respx.get(url__startswith=f"{BASE}/git/status").mock(
        return_value=httpx.Response(200, json={"status": "S"})
    )
    assert await box.git.diff() == "D"
    assert await box.git.status() == "S"
    await box.aclose()


@respx.mock
async def test_commit():
    box = await make_async_box(respx.mock)
    respx.post(f"{BASE}/git/commit").mock(
        return_value=httpx.Response(200, json={"sha": "abc", "message": "feat: x"})
    )
    result = await box.git.commit(message="feat: x", author_name="Jane")
    assert result.sha == "abc"
    assert result.message == "feat: x"
    await box.aclose()


@respx.mock
async def test_update_config_requires_one_field():
    box = await make_async_box(respx.mock)
    with pytest.raises(BoxError, match="user_name or user_email"):
        await box.git.update_config()
    await box.aclose()


@respx.mock
async def test_update_config():
    box = await make_async_box(respx.mock)
    route = respx.put(f"{BASE}/git-config").mock(
        return_value=httpx.Response(
            200, json={"git_user_name": "Jane", "git_user_email": "j@e.com"}
        )
    )
    cfg = await box.git.update_config(user_name="Jane", user_email="j@e.com")
    assert cfg.git_user_name == "Jane"
    body = last_json_body(route)
    assert body == {"git_user_name": "Jane", "git_user_email": "j@e.com"}
    await box.aclose()


@respx.mock
async def test_push_and_create_pr_and_exec_and_checkout():
    box = await make_async_box(respx.mock)
    respx.post(f"{BASE}/git/push").mock(return_value=httpx.Response(200, json={}))
    respx.post(f"{BASE}/git/create-pr").mock(
        return_value=httpx.Response(
            200, json={"url": "u", "number": 5, "title": "t", "base": "main"}
        )
    )
    respx.post(f"{BASE}/git/exec").mock(return_value=httpx.Response(200, json={"output": "log"}))
    respx.post(f"{BASE}/git/checkout").mock(return_value=httpx.Response(200, json={}))

    await box.git.push(branch="main")
    pr = await box.git.create_pr(title="t", body="b")
    assert pr.number == 5
    assert await box.git.exec(args=["log", "--oneline"]) == "log"
    await box.git.checkout(branch="feature")
    await box.aclose()
