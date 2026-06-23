import httpx
import pytest
import respx
from helpers import (
    TEST_BASE_URL,
    last_json_body,
    make_async_box,
    sse_response,
    sse_response_chunked,
)
from pydantic import BaseModel

from upstash_box import BoxError

RUN_URL = f"{TEST_BASE_URL}/v2/box/box-123/run/stream"
RUN_WEBHOOK_URL = f"{TEST_BASE_URL}/v2/box/box-123/run"


@respx.mock
async def test_streams_text_and_completes():
    box = await make_async_box(respx.mock)
    respx.post(RUN_URL).mock(
        return_value=sse_response(
            [
                {"event": "run_start", "data": {"run_id": "real-run-1"}},
                {"event": "text", "data": {"text": "Hello "}},
                {"event": "text", "data": {"text": "world"}},
                {"event": "done", "data": {"input_tokens": 10, "output_tokens": 20}},
            ]
        )
    )
    run = await box.agent.run(prompt="say hello")
    assert run.id == "real-run-1"
    assert run.result == "Hello world"
    assert run.status == "completed"
    assert run.cost.input_tokens == 10
    assert run.cost.output_tokens == 20


@respx.mock
async def test_total_usd_from_done():
    box = await make_async_box(respx.mock)
    respx.post(RUN_URL).mock(
        return_value=sse_response(
            [
                {"event": "run_start", "data": {"run_id": "r1"}},
                {"event": "text", "data": {"text": "answer"}},
                {
                    "event": "done",
                    "data": {"input_tokens": 100, "output_tokens": 50, "total_cost_usd": 0.00123},
                },
            ]
        )
    )
    run = await box.agent.run(prompt="test")
    assert run.cost.total_usd == 0.00123
    assert run.cost.cached_input_tokens == 0


@respx.mock
async def test_cached_input_tokens():
    box = await make_async_box(respx.mock)
    respx.post(RUN_URL).mock(
        return_value=sse_response(
            [
                {"event": "run_start", "data": {"run_id": "r1"}},
                {
                    "event": "done",
                    "data": {"input_tokens": 100, "output_tokens": 50, "cached_input_tokens": 80},
                },
            ]
        )
    )
    run = await box.agent.run(prompt="test")
    assert run.cost.cached_input_tokens == 80


@respx.mock
async def test_on_tool_use_callback():
    box = await make_async_box(respx.mock)
    tools = []
    respx.post(RUN_URL).mock(
        return_value=sse_response(
            [
                {"event": "run_start", "data": {"run_id": "r1"}},
                {
                    "event": "tool",
                    "data": {"id": "tool-1", "name": "Read", "input": {"path": "/test"}},
                },
                {"event": "done", "data": {}},
            ]
        )
    )
    await box.agent.run(prompt="test", on_tool_use=lambda t: tools.append(t))
    assert len(tools) == 1
    assert tools[0]["tool_call_id"] == "tool-1"
    assert tools[0]["name"] == "Read"


@respx.mock
async def test_on_tool_result_callback():
    box = await make_async_box(respx.mock)
    results = []
    respx.post(RUN_URL).mock(
        return_value=sse_response(
            [
                {"event": "run_start", "data": {"run_id": "r1"}},
                {"event": "tool_result", "data": {"toolCallId": "tool-1", "output": {"ok": True}}},
                {"event": "done", "data": {}},
            ]
        )
    )
    await box.agent.run(prompt="test", on_tool_result=lambda r: results.append(r))
    assert results == [{"tool_call_id": "tool-1", "output": {"ok": True}}]


@respx.mock
async def test_structured_output_pydantic():
    box = await make_async_box(respx.mock)
    respx.post(RUN_URL).mock(
        return_value=sse_response(
            [
                {"event": "run_start", "data": {"run_id": "r1"}},
                {"event": "text", "data": {"text": '{"name":"test","count":42}'}},
                {"event": "done", "data": {}},
            ]
        )
    )

    class Result(BaseModel):
        name: str
        count: int

    run = await box.agent.run(prompt="test", response_schema=Result)
    assert run.result == Result(name="test", count=42)


@respx.mock
async def test_structured_output_raw_dict_schema():
    box = await make_async_box(respx.mock)
    route = respx.post(RUN_URL).mock(
        return_value=sse_response(
            [
                {"event": "run_start", "data": {"run_id": "r1"}},
                {"event": "done", "data": {"output": '{"name":"test","count":42}'}},
            ]
        )
    )
    schema = {"type": "object", "properties": {"name": {"type": "string"}}}
    run = await box.agent.run(prompt="analyze", response_schema=schema)
    assert run.result == {"name": "test", "count": 42}
    assert last_json_body(route)["json_schema"] == schema


@respx.mock
async def test_sends_json_schema_for_pydantic():
    box = await make_async_box(respx.mock)
    route = respx.post(RUN_URL).mock(
        return_value=sse_response(
            [
                {"event": "run_start", "data": {"run_id": "r1"}},
                {"event": "done", "data": {"output": '{"name":"x","count":1}'}},
            ]
        )
    )

    class Result(BaseModel):
        name: str
        count: int

    await box.agent.run(prompt="analyze this", response_schema=Result)
    body = last_json_body(route)
    assert body["prompt"] == "analyze this"
    assert body["json_schema"]["properties"]["name"] == {"title": "Name", "type": "string"}


@respx.mock
async def test_invalid_structured_output_raises():
    box = await make_async_box(respx.mock)
    respx.post(RUN_URL).mock(
        return_value=sse_response(
            [
                {"event": "run_start", "data": {"run_id": "r1"}},
                {"event": "text", "data": {"text": "not json"}},
                {"event": "done", "data": {}},
            ]
        )
    )

    class Result(BaseModel):
        value: int

    with pytest.raises(BoxError, match="Failed to parse structured output"):
        await box.agent.run(prompt="test", response_schema=Result)


@respx.mock
async def test_uses_done_output_when_available():
    box = await make_async_box(respx.mock)
    respx.post(RUN_URL).mock(
        return_value=sse_response(
            [
                {"event": "run_start", "data": {"run_id": "r1"}},
                {"event": "text", "data": {"text": "partial"}},
                {"event": "done", "data": {"output": "final output"}},
            ]
        )
    )
    run = await box.agent.run(prompt="test")
    assert run.result == "final output"


@respx.mock
async def test_missing_prompt_raises():
    box = await make_async_box(respx.mock)
    with pytest.raises(BoxError, match="prompt is required"):
        await box.agent.run(prompt="")


@respx.mock
async def test_stream_error_event_raises():
    box = await make_async_box(respx.mock)
    respx.post(RUN_URL).mock(
        return_value=sse_response(
            [
                {"event": "run_start", "data": {"run_id": "r1"}},
                {"event": "error", "data": {"error": "something broke"}},
            ]
        )
    )
    with pytest.raises(BoxError, match="something broke"):
        await box.agent.run(prompt="test")


@respx.mock
async def test_non_ok_response_raises():
    box = await make_async_box(respx.mock)
    respx.post(RUN_URL).mock(return_value=httpx.Response(500, json={"error": "server error"}))
    with pytest.raises(BoxError, match="server error"):
        await box.agent.run(prompt="test")


@respx.mock
async def test_webhook_run_returns_immediately():
    box = await make_async_box(respx.mock)
    route = respx.post(RUN_WEBHOOK_URL).mock(
        return_value=httpx.Response(200, json={"status": "accepted", "run_id": "wh-1"})
    )
    run = await box.agent.run(
        prompt="do something",
        webhook={"url": "https://example.com/hook", "headers": {"X-Custom": "value"}},
    )
    assert run.id == "wh-1"
    body = last_json_body(route)
    assert body["webhook"] == {"url": "https://example.com/hook", "headers": {"X-Custom": "value"}}


@respx.mock
async def test_no_agent_configured_raises():
    box = await make_async_box(respx.mock, {"model": None, "agent": None})
    with pytest.raises(BoxError, match="No agent configured"):
        await box.agent.run(prompt="test")


@respx.mock
async def test_codex_agent_options_snake_case_passthrough():
    box = await make_async_box(respx.mock, {"agent": "codex"})
    route = respx.post(RUN_URL).mock(
        return_value=sse_response(
            [
                {"event": "run_start", "data": {"run_id": "r1"}},
                {"event": "done", "data": {"output": "ok"}},
            ]
        )
    )
    # Public options are snake_case; Codex backend uses snake_case (pass-through).
    await box.agent.run(
        prompt="test",
        options={"model_reasoning_effort": "high", "personality": "pragmatic", "web_search": True},
    )
    assert last_json_body(route)["agent_options"] == {
        "model_reasoning_effort": "high",
        "personality": "pragmatic",
        "web_search": True,
    }


@respx.mock
async def test_claude_code_agent_options_snake_to_camel():
    box = await make_async_box(respx.mock, {"agent": "claude-code"})
    route = respx.post(RUN_URL).mock(
        return_value=sse_response(
            [
                {"event": "run_start", "data": {"run_id": "r1"}},
                {"event": "done", "data": {"output": "ok"}},
            ]
        )
    )
    # Public snake_case options are converted to the camelCase Claude Code backend wants.
    await box.agent.run(prompt="test", options={"max_turns": 5, "system_prompt": "be terse"})
    assert last_json_body(route)["agent_options"] == {"maxTurns": 5, "systemPrompt": "be terse"}


@respx.mock
async def test_stream_yields_chunks_in_order():
    box = await make_async_box(respx.mock)
    respx.post(RUN_URL).mock(
        return_value=sse_response(
            [
                {"event": "run_start", "data": {"run_id": "r1"}},
                {"event": "text", "data": {"text": "Hello "}},
                {"event": "thinking", "data": {"text": "trace"}},
                {
                    "event": "tool",
                    "data": {"toolCallId": "t4", "name": "Write", "input": {"path": "/x"}},
                },
                {"event": "tool_result", "data": {"tool_use_id": "t4", "output": "done"}},
                {
                    "event": "done",
                    "data": {
                        "output": "Hello world",
                        "input_tokens": 7,
                        "output_tokens": 9,
                        "session_id": "s1",
                    },
                },
                {"event": "stats", "data": {"cpu_ns": 111, "memory_peak_bytes": 222}},
            ]
        )
    )
    stream = await box.agent.stream(prompt="test")
    chunks = [c async for c in stream]
    assert [c.type for c in chunks] == [
        "start",
        "text-delta",
        "reasoning",
        "tool-call",
        "tool-result",
        "finish",
        "stats",
    ]
    assert stream.result == "Hello world"
    assert stream.status == "completed"


@respx.mock
async def test_stream_detached_on_early_break():
    box = await make_async_box(respx.mock)
    respx.post(RUN_URL).mock(
        return_value=sse_response_chunked(
            [
                {"event": "run_start", "data": {"run_id": "r1"}},
                {"event": "text", "data": {"text": "Hello "}},
                {"event": "text", "data": {"text": "world"}},
                {"event": "done", "data": {"output": "Hello world"}},
            ]
        )
    )
    stream = await box.agent.stream(prompt="test")
    async for chunk in stream:
        if chunk.type == "text-delta":
            break
    # Python doesn't run the generator finally on break — close explicitly.
    await stream.aclose()
    assert stream.status == "detached"
    assert stream.result == "Hello"


@respx.mock
async def test_stream_failed_preserves_partial_output():
    box = await make_async_box(respx.mock)
    respx.post(RUN_URL).mock(
        return_value=sse_response_chunked(
            [
                {"event": "run_start", "data": {"run_id": "r1"}},
                {"event": "text", "data": {"text": "partial"}},
                {"event": "error", "data": {"error": "boom"}},
            ]
        )
    )
    stream = await box.agent.stream(prompt="test")
    with pytest.raises(BoxError, match="boom"):
        async for _ in stream:
            pass
    assert stream.status == "failed"
    assert stream.result == "partial"
