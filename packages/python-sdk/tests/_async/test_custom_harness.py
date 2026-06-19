import pytest

from upstash_box import CustomHarnessDone, run_custom_harness


async def test_parses_args_and_emits_events():
    out = []

    async def handler(ctx, emit):
        emit.tool({"tool_call_id": "tool-1", "name": "custom", "input": {"model": ctx.model}})
        emit.tool_result({"tool_call_id": "tool-1", "output": "ok"})
        emit.reasoning("trace")
        emit.text(f"CUSTOM_OK {ctx.prompt}")
        return CustomHarnessDone(
            output=f"CUSTOM_OK {ctx.prompt}",
            input_tokens=2,
            output_tokens=3,
            session_id=ctx.session_id,
        )

    await run_custom_harness(
        handler,
        argv=["-p", "hello world", "--model", "custom/demo", "--session", "s1", "--stream"],
        write=out.append,
    )
    text = "".join(out)
    assert 'event: tool\ndata: {"toolCallId":"tool-1","name":"custom"' in text
    assert 'event: tool_result\ndata: {"toolCallId":"tool-1","output":"ok"}' in text
    assert 'event: thinking\ndata: {"text":"trace"}' in text
    assert 'event: text\ndata: {"text":"CUSTOM_OK hello world"}' in text
    assert '"output":"CUSTOM_OK hello world"' in text
    assert '"session_id":"s1"' in text


async def test_string_return_emits_done():
    out = []

    async def handler(ctx, emit):
        return "just a string"

    await run_custom_harness(handler, argv=["-p", "x"], write=out.append)
    assert '"output":"just a string"' in "".join(out)


async def test_emits_error_before_reraising():
    out = []

    async def handler(ctx, emit):
        raise ValueError("boom")

    with pytest.raises(ValueError, match="boom"):
        await run_custom_harness(handler, argv=["-p", "x"], write=out.append)
    assert 'event: error\ndata: {"error":"boom"' in "".join(out)


async def test_sync_handler_supported():
    out = []

    def handler(ctx, emit):
        emit.text("sync")
        return "sync"

    await run_custom_harness(handler, argv=["-p", "x"], write=out.append)
    assert '"output":"sync"' in "".join(out)
