import httpx
import respx
from helpers import TEST_BASE_URL, last_json_body, make_async_box

BASE = f"{TEST_BASE_URL}/v2/box/box-123"


def _sched(**over):
    base = {
        "id": "sched-1",
        "box_id": "box-123",
        "type": "exec",
        "cron": "* * * * *",
        "status": "active",
        "total_runs": 0,
        "total_failures": 0,
        "created_at": 1,
        "updated_at": 1,
    }
    base.update(over)
    return base


@respx.mock
async def test_schedule_exec():
    box = await make_async_box(respx.mock)
    route = respx.post(f"{BASE}/schedules").mock(return_value=httpx.Response(200, json=_sched()))
    sched = await box.schedule.exec(cron="* * * * *", command=["bash", "-c", "date"])
    assert sched.id == "sched-1"
    body = last_json_body(route)
    assert body["type"] == "exec"
    assert body["command"] == ["bash", "-c", "date"]
    assert body["folder"] == "/workspace/home"
    await box.aclose()


@respx.mock
async def test_schedule_agent():
    box = await make_async_box(respx.mock)
    route = respx.post(f"{BASE}/schedules").mock(
        return_value=httpx.Response(200, json=_sched(type="prompt"))
    )
    sched = await box.schedule.agent(cron="0 9 * * *", prompt="run tests", timeout=300000)
    assert sched.type == "prompt"
    body = last_json_body(route)
    assert body["type"] == "prompt"
    assert body["prompt"] == "run tests"
    assert body["timeout"] == 300000
    await box.aclose()


@respx.mock
async def test_schedule_agent_timeout_zero_is_sent():
    box = await make_async_box(respx.mock)
    route = respx.post(f"{BASE}/schedules").mock(
        return_value=httpx.Response(200, json=_sched(type="prompt"))
    )
    # timeout=0 must reach the body (not dropped by truthiness).
    await box.schedule.agent(cron="* * * * *", prompt="x", timeout=0)
    assert last_json_body(route)["timeout"] == 0
    await box.aclose()


@respx.mock
async def test_schedule_list_get_pause_resume_delete():
    box = await make_async_box(respx.mock)
    respx.get(f"{BASE}/schedules").mock(return_value=httpx.Response(200, json=[_sched()]))
    respx.get(f"{BASE}/schedules/sched-1").mock(return_value=httpx.Response(200, json=_sched()))
    respx.post(f"{BASE}/schedules/sched-1/pause").mock(return_value=httpx.Response(200, json={}))
    respx.post(f"{BASE}/schedules/sched-1/resume").mock(return_value=httpx.Response(200, json={}))
    respx.delete(f"{BASE}/schedules/sched-1").mock(return_value=httpx.Response(200, json={}))

    assert len(await box.schedule.list()) == 1
    assert (await box.schedule.get("sched-1")).id == "sched-1"
    await box.schedule.pause("sched-1")
    await box.schedule.resume("sched-1")
    await box.schedule.delete("sched-1")
    await box.aclose()
