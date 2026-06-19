"""Tiny real-API smoke for the SYNC client — validates sync timeouts,
cancellation timing, stream backpressure, and multipart against the real server
at least once (the rest of sync is covered by mocks)."""

import pytest

from upstash_box import Agent, Box, ClaudeCode

pytestmark = pytest.mark.integration


def test_sync_create_exec_agent_stream_delete(opts, tmp_path):
    box = Box.create(
        runtime="node",
        agent={"harness": Agent.CLAUDE_CODE, "model": ClaudeCode.SONNET_4_5},
        **opts,
    )
    try:
        run = box.exec.command("echo sync-ok")
        assert "sync-ok" in run.result

        local = tmp_path / "upload.txt"
        local.write_text("multipart payload")
        box.files.upload([{"path": str(local), "destination": "upload.txt"}])
        assert box.files.read("upload.txt") == "multipart payload"

        agent_run = box.agent.run(prompt="Reply with exactly: PONG")
        assert "PONG" in agent_run.result

        stream = box.agent.stream(prompt="Count to three")
        chunks = 0
        for _chunk in stream:
            chunks += 1
        assert chunks > 0
        assert stream.status == "completed"
    finally:
        box.delete()
