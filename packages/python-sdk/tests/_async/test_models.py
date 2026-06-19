"""Strict field assertions for key response models, so extra='allow' can't mask
a backend contract regression."""

from upstash_box import (
    BoxRunData,
    FinishChunk,
    FinishUsage,
    PublicURL,
    RunCost,
    Schedule,
    Snapshot,
    StartChunk,
    TextDeltaChunk,
    ToolCallChunk,
)


def test_box_run_data_fields():
    run = BoxRunData.model_validate(
        {
            "id": "r1",
            "box_id": "b",
            "customer_id": "c",
            "type": "agent",
            "status": "completed",
            "input_tokens": 10,
            "output_tokens": 5,
            "cost_usd": 0.01,
            "duration_ms": 1234,
            "created_at": 100,
        }
    )
    assert run.id == "r1"
    assert run.type == "agent"
    assert run.input_tokens == 10
    assert run.cost_usd == 0.01


def test_schedule_fields():
    sched = Schedule.model_validate(
        {
            "id": "s1",
            "box_id": "b",
            "type": "prompt",
            "cron": "* * * * *",
            "status": "active",
            "total_runs": 2,
            "total_failures": 0,
            "created_at": 1,
            "updated_at": 2,
        }
    )
    assert sched.type == "prompt"
    assert sched.total_runs == 2


def test_snapshot_fields():
    snap = Snapshot.model_validate(
        {
            "id": "s1",
            "name": "n",
            "box_id": "b",
            "size_bytes": 5,
            "status": "ready",
            "created_at": 9,
        }
    )
    assert snap.status == "ready"
    assert snap.size_bytes == 5


def test_public_url_fields():
    url = PublicURL.model_validate({"url": "https://x", "port": 3000})
    assert url.port == 3000
    assert url.token is None


def test_chunk_dataclasses():
    assert StartChunk(run_id="r").type == "start"
    assert TextDeltaChunk(text="hi").type == "text-delta"
    tc = ToolCallChunk(tool_name="Read", input={"path": "/x"}, tool_call_id="t1")
    assert tc.type == "tool-call"
    assert tc.tool_name == "Read"
    finish = FinishChunk(output="done", usage=FinishUsage(input_tokens=1, output_tokens=2))
    assert finish.usage.output_tokens == 2


def test_run_cost_defaults():
    cost = RunCost()
    assert cost.input_tokens == 0
    assert cost.total_usd == 0
