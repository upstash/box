"""skills, config_model, public URLs, lifecycle, init-command, logs, list_runs."""

import httpx
import pytest
import respx
from helpers import TEST_BASE_URL, last_json_body, make_async_box

from upstash_box import BoxError

BASE = f"{TEST_BASE_URL}/v2/box/box-123"


# ---------- skills ----------


@respx.mock
async def test_skill_add_remove_list():
    box = await make_async_box(respx.mock)
    add = respx.post(f"{BASE}/config/skills").mock(return_value=httpx.Response(200, json={}))
    respx.delete(f"{BASE}/config/skills/owner/repo/skill").mock(
        return_value=httpx.Response(200, json={})
    )
    respx.get(f"{BASE}").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "box-123",
                "status": "running",
                "created_at": 1,
                "updated_at": 1,
                "enabled_skills": ["a/b/c"],
            },
        )
    )
    await box.skills.add("owner/repo/skill")
    assert last_json_body(add) == {"skill_id": "owner/repo/skill"}
    await box.skills.remove("owner/repo/skill")
    assert await box.skills.list() == ["a/b/c"]
    await box.aclose()


# ---------- labels ----------


@respx.mock
async def test_label_add_remove_list():
    box = await make_async_box(respx.mock)
    add = respx.post(f"{BASE}/config/labels").mock(
        return_value=httpx.Response(
            200, json={"message": "Label added", "labels": ["beta", "x-team"]}
        )
    )
    remove = respx.delete(f"{BASE}/config/labels/beta").mock(
        return_value=httpx.Response(200, json={"message": "Label removed", "labels": ["x-team"]})
    )
    respx.get(f"{BASE}").mock(
        return_value=httpx.Response(
            200,
            json={
                "id": "box-123",
                "status": "running",
                "created_at": 1,
                "updated_at": 1,
                "labels": ["beta", "x-team"],
            },
        )
    )
    assert await box.labels.add("x-team") == ["beta", "x-team"]
    assert last_json_body(add) == {"label": "x-team"}
    assert await box.labels.remove("beta") == ["x-team"]
    assert remove.called
    assert await box.labels.list() == ["beta", "x-team"]
    await box.aclose()


@respx.mock
async def test_label_add_raises_on_conflict():
    box = await make_async_box(respx.mock)
    respx.post(f"{BASE}/config/labels").mock(
        return_value=httpx.Response(409, json={"error": "Label already added"})
    )
    with pytest.raises(BoxError, match="Label already added"):
        await box.labels.add("beta")
    await box.aclose()


# ---------- configure_model ----------


@respx.mock
async def test_configure_model():
    box = await make_async_box(respx.mock)
    route = respx.put(f"{BASE}/config/model").mock(return_value=httpx.Response(200, json={}))
    await box.configure_model("anthropic/claude-opus-4-5")
    assert box.model_config["model"] == "anthropic/claude-opus-4-5"
    assert last_json_body(route) == {"model": "anthropic/claude-opus-4-5"}
    await box.aclose()


# ---------- public URLs ----------


@respx.mock
async def test_public_urls():
    box = await make_async_box(respx.mock)
    respx.post(f"{BASE}/preview").mock(
        return_value=httpx.Response(200, json={"url": "https://x", "port": 3000, "token": "t"})
    )
    respx.get(f"{BASE}/preview").mock(
        return_value=httpx.Response(200, json={"previews": [{"url": "https://x", "port": 3000}]})
    )
    respx.delete(f"{BASE}/preview/3000").mock(return_value=httpx.Response(200, json={}))

    url = await box.get_public_url(3000, bearer_token=True)
    assert url.url == "https://x"
    assert url.token == "t"
    listed = await box.list_public_urls()
    assert listed["public_urls"][0].port == 3000
    await box.delete_public_url(3000)
    await box.aclose()


# ---------- lifecycle ----------


@respx.mock
async def test_get_status_pause_resume():
    box = await make_async_box(respx.mock)
    respx.get(f"{BASE}/status").mock(return_value=httpx.Response(200, json={"status": "idle"}))
    respx.post(f"{BASE}/pause").mock(return_value=httpx.Response(200, json={}))
    respx.post(f"{BASE}/resume").mock(return_value=httpx.Response(200, json={}))
    assert (await box.get_status())["status"] == "idle"
    await box.pause()
    await box.resume()
    await box.aclose()


@respx.mock
async def test_keep_alive_box_cannot_pause():
    box = await make_async_box(respx.mock, {"keep_alive": True})
    with pytest.raises(BoxError, match="cannot be paused"):
        await box.pause()
    await box.aclose()


# ---------- init command ----------


@respx.mock
async def test_init_command_requires_keep_alive():
    box = await make_async_box(respx.mock)
    with pytest.raises(BoxError, match="only available for keep-alive"):
        await box.get_init_command()
    await box.aclose()


@respx.mock
async def test_init_command_crud():
    box = await make_async_box(respx.mock, {"keep_alive": True})
    respx.get(f"{BASE}/startup").mock(
        return_value=httpx.Response(200, json={"init_command": "npm run dev"})
    )
    respx.put(f"{BASE}/startup").mock(return_value=httpx.Response(200, json={}))
    respx.delete(f"{BASE}/startup").mock(return_value=httpx.Response(200, json={}))
    assert await box.get_init_command() == "npm run dev"
    await box.set_init_command("npm start")
    await box.delete_init_command()
    await box.aclose()


# ---------- logs / list_runs ----------


@respx.mock
async def test_logs_and_list_runs():
    box = await make_async_box(respx.mock)
    respx.get(url__startswith=f"{BASE}/logs").mock(
        return_value=httpx.Response(
            200,
            json={
                "logs": [{"timestamp": 100, "level": "info", "source": "agent", "message": "hi"}]
            },
        )
    )
    respx.get(f"{BASE}/runs").mock(
        return_value=httpx.Response(
            200,
            json={
                "runs": [
                    {
                        "id": "r1",
                        "box_id": "box-123",
                        "customer_id": "c",
                        "type": "agent",
                        "status": "completed",
                    }
                ]
            },
        )
    )
    logs = await box.logs()
    assert logs[0].message == "hi"
    runs = await box.list_runs()
    assert runs[0].id == "r1"
    await box.aclose()


# ---------- update_network_policy ----------


@respx.mock
async def test_update_network_policy():
    box = await make_async_box(respx.mock)
    route = respx.put(f"{BASE}/config/network-policy").mock(
        return_value=httpx.Response(200, json={})
    )
    await box.update_network_policy({"mode": "deny-all"})
    assert box.network_policy == {"mode": "deny-all"}
    assert last_json_body(route) == {"mode": "deny-all"}
    await box.aclose()
