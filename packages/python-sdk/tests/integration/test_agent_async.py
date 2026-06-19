"""Full async integration smoke against the real API."""

import pytest

from upstash_box import Agent, AsyncBox, ClaudeCode

pytestmark = pytest.mark.integration


async def test_agent_exec_files_lifecycle(opts):
    box = await AsyncBox.create(
        runtime="node",
        agent={"harness": Agent.CLAUDE_CODE, "model": ClaudeCode.SONNET_4_5},
        **opts,
    )
    try:
        # exec
        run = await box.exec.command("echo integration-ok")
        assert "integration-ok" in run.result
        assert run.exit_code == 0

        # files
        await box.files.write(path="hello.txt", content="hi from python")
        assert await box.files.read("hello.txt") == "hi from python"

        # agent (non-stream)
        agent_run = await box.agent.run(prompt="Reply with exactly: PONG")
        assert "PONG" in agent_run.result

        # agent (stream)
        stream = await box.agent.stream(prompt="Say hello in one word")
        text = ""
        async for chunk in stream:
            if chunk.type == "text-delta":
                text += chunk.text
        assert stream.status == "completed"
    finally:
        await box.delete()
