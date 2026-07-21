import httpx
import respx
from helpers import TEST_BASE_URL, last_json_body, make_async_box, raw_stream_response

EXEC_URL = f"{TEST_BASE_URL}/v2/box/box-123/exec"
CODE_URL = f"{TEST_BASE_URL}/v2/box/box-123/code"
EXEC_STREAM_URL = f"{TEST_BASE_URL}/v2/box/box-123/exec-stream"


@respx.mock
async def test_exec_command_success():
    box = await make_async_box(respx.mock)
    route = respx.post(EXEC_URL).mock(
        return_value=httpx.Response(200, json={"exit_code": 0, "output": "hello"})
    )
    run = await box.exec.command("echo hello")
    assert run.result == "hello"
    assert run.status == "completed"
    assert run.exit_code == 0
    assert last_json_body(route)["command"] == ["sh", "-c", "echo hello"]
    await box.aclose()


@respx.mock
async def test_exec_command_failure_uses_error():
    box = await make_async_box(respx.mock)
    respx.post(EXEC_URL).mock(
        return_value=httpx.Response(200, json={"exit_code": 1, "output": "", "error": "boom"})
    )
    run = await box.exec.command("false")
    assert run.result == "boom"
    assert run.status == "failed"
    assert run.exit_code == 1
    await box.aclose()


@respx.mock
async def test_exec_command_stderr_does_not_shadow_stdout_on_success():
    box = await make_async_box(respx.mock)
    respx.post(EXEC_URL).mock(
        return_value=httpx.Response(
            200, json={"exit_code": 0, "output": "out line\n", "error": "warning line\n"}
        )
    )
    run = await box.exec.command("echo 'out line'; echo 'warning line' >&2")
    assert run.result == "out line\n"
    assert run.stdout == "out line\n"
    assert run.stderr == "warning line\n"
    assert run.status == "completed"
    await box.aclose()


@respx.mock
async def test_exec_command_failure_exposes_both_streams():
    box = await make_async_box(respx.mock)
    respx.post(EXEC_URL).mock(
        return_value=httpx.Response(
            200, json={"exit_code": 1, "output": "partial out\n", "error": "boom\n"}
        )
    )
    run = await box.exec.command("exit 1")
    assert run.result == "boom\n"
    assert run.stdout == "partial out\n"
    assert run.stderr == "boom\n"
    assert run.status == "failed"
    await box.aclose()


@respx.mock
async def test_exec_code():
    box = await make_async_box(respx.mock)
    route = respx.post(CODE_URL).mock(
        return_value=httpx.Response(200, json={"exit_code": 0, "output": "42"})
    )
    run = await box.exec.code(code="print(42)", lang="python")
    assert run.result == "42"
    body = last_json_body(route)
    assert body["code"] == "print(42)"
    assert body["language"] == "python"
    await box.aclose()


@respx.mock
async def test_exec_stream_yields_output_and_exit():
    box = await make_async_box(respx.mock)
    chunks = [b"hello ", b"world", b'event: exit\ndata: {"exit_code": 0, "cpu_ns": 5}\n\n']
    respx.post(EXEC_STREAM_URL).mock(return_value=raw_stream_response(chunks))
    stream = await box.exec.stream("echo hello world")
    collected = [c async for c in stream]
    outputs = "".join(c.data for c in collected if c.type == "output")
    assert outputs == "hello world"
    exits = [c for c in collected if c.type == "exit"]
    assert exits[0].exit_code == 0
    assert stream.status == "completed"
    assert stream.result == "hello world"
    await box.aclose()


@respx.mock
async def test_exec_stream_marker_split_across_chunks():
    box = await make_async_box(respx.mock)
    # The "event: exit" marker is split across two network chunks.
    chunks = [b"out", b"put-data", b"event: ex", b'it\ndata: {"exit_code": 3}\n\n']
    respx.post(EXEC_STREAM_URL).mock(return_value=raw_stream_response(chunks))
    stream = await box.exec.stream("x")
    collected = [c async for c in stream]
    outputs = "".join(c.data for c in collected if c.type == "output")
    assert outputs == "output-data"
    exits = [c for c in collected if c.type == "exit"]
    assert exits[0].exit_code == 3
    assert stream.status == "failed"
    await box.aclose()
