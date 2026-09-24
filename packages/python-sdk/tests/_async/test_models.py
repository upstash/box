"""Strict field assertions for key response models, so extra='allow' can't mask
a backend contract regression."""

from upstash_box import (
    BoxRunData,
    ClaudeCode,
    CursorModel,
    FinishChunk,
    FinishUsage,
    OpenAICodex,
    OpenCodeModel,
    OpenRouterModel,
    PublicURL,
    RunCost,
    Schedule,
    Snapshot,
    StartChunk,
    TextDeltaChunk,
    ToolCallChunk,
    VercelModel,
)


def test_claude_opus_5_5_model_identifier():
    assert {
        ClaudeCode.OPUS_5_5.value,
        CursorModel.CLAUDE_OPUS_5_5.value,
        OpenCodeModel.CLAUDE_OPUS_5_5.value,
        OpenCodeModel.ZEN_CLAUDE_OPUS_5_5.value,
        OpenRouterModel.CLAUDE_OPUS_5_5.value,
        VercelModel.CLAUDE_OPUS_5_5.value,
    } == {
        "anthropic/claude-opus-5-5",
        "cursor/claude-opus-5-5",
        "opencode/claude-opus-5-5",
        "openrouter/anthropic/claude-opus-5.5",
        "vercel/anthropic/claude-opus-5.5",
    }


def test_gpt_6_sol_and_luna_model_identifiers():
    assert OpenAICodex.GPT_6_SOL.value == "openai/gpt-6-sol"
    assert OpenAICodex.GPT_6_LUNA.value == "openai/gpt-6-luna"
    assert OpenRouterModel.GPT_6_SOL.value == "openrouter/openai/gpt-6-sol"
    assert OpenRouterModel.GPT_6_LUNA.value == "openrouter/openai/gpt-6-luna"
    assert OpenCodeModel.GPT_6_SOL.value == "opencode/gpt-6-sol"
    assert OpenCodeModel.GPT_6_LUNA.value == "opencode/gpt-6-luna"


def test_vercel_gateway_model_identifiers():
    # xAI models moved from the xai/ to the spacexai/ namespace on the gateway.
    assert VercelModel.GROK_BUILD_0_1.value == "vercel/spacexai/grok-build-0.1"
    assert VercelModel.GROK_4_7.value == "vercel/spacexai/grok-4.7"
    assert VercelModel.GROK_4_3.value == "vercel/spacexai/grok-4.3"
    assert VercelModel.GROK_4_20_REASONING.value == "vercel/spacexai/grok-4.20-reasoning"
    assert VercelModel.GPT_6_SOL.value == "vercel/openai/gpt-6-sol"
    assert VercelModel.GPT_6_LUNA.value == "vercel/openai/gpt-6-luna"
    assert VercelModel.GEMINI_3_8_FLASH.value == "vercel/google/gemini-3.8-flash"
    assert not any(m.value.startswith("vercel/xai/") for m in VercelModel)


def test_claude_opus_5_model_identifier():
    assert {
        ClaudeCode.OPUS_5.value,
        CursorModel.CLAUDE_OPUS_5.value,
        OpenCodeModel.CLAUDE_OPUS_5.value,
        OpenCodeModel.ZEN_CLAUDE_OPUS_5.value,
        OpenRouterModel.CLAUDE_OPUS_5.value,
        VercelModel.CLAUDE_OPUS_5.value,
    } == {
        "anthropic/claude-opus-5",
        "cursor/claude-opus-5",
        "opencode/claude-opus-5",
        "openrouter/anthropic/claude-opus-5",
        "vercel/anthropic/claude-opus-5",
    }


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
