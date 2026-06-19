import httpx
import respx
from helpers import TEST_BASE_URL, make_async_box, sse_response

BASE = f"{TEST_BASE_URL}/v2/box/box-123"
RUN_URL = f"{BASE}/run/stream"


@respx.mock
async def test_run_cancel_sets_status_and_swallows_errors():
    box = await make_async_box(respx.mock)
    respx.post(RUN_URL).mock(
        return_value=sse_response(
            [
                {"event": "run_start", "data": {"run_id": "r1"}},
                {"event": "done", "data": {"output": "ok"}},
            ]
        )
    )
    run = await box.agent.run(prompt="x")
    # Cancel endpoint returns an error — cancel() must not raise.
    respx.post(f"{BASE}/runs/r1/cancel").mock(
        return_value=httpx.Response(500, json={"error": "nope"})
    )
    await run.cancel()
    assert run.status == "cancelled"
    await box.aclose()


@respx.mock
async def test_run_logs_iso_conversion_and_lower_bound():
    box = await make_async_box(respx.mock)
    respx.post(RUN_URL).mock(
        return_value=sse_response(
            [
                {"event": "run_start", "data": {"run_id": "r1"}},
                {"event": "done", "data": {"output": "ok"}},
            ]
        )
    )
    run = await box.agent.run(prompt="x")
    start_sec = int(run._start_time / 1000)
    respx.get(url__startswith=f"{BASE}/logs").mock(
        return_value=httpx.Response(
            200,
            json={
                "logs": [
                    {
                        "timestamp": start_sec - 100,
                        "level": "info",
                        "source": "system",
                        "message": "before",
                    },
                    {
                        "timestamp": start_sec + 5,
                        "level": "warn",
                        "source": "agent",
                        "message": "after",
                    },
                ]
            },
        )
    )
    logs = await run.logs()
    # Lower bound only — the "before" entry is filtered out.
    assert len(logs) == 1
    assert logs[0].message == "after"
    assert logs[0].timestamp.endswith("Z")
    assert "T" in logs[0].timestamp
    await box.aclose()
