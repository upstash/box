"""Ephemeral box — exec, files, cwd, status. No agent/git/skills surface."""

import pytest

from upstash_box import AsyncEphemeralBox

pytestmark = pytest.mark.integration


async def test_ephemeral_exec_files(opts):
    box = await AsyncEphemeralBox.create(runtime="node", ttl=600, **opts)
    try:
        assert box.expires_at > 0
        assert not hasattr(box, "agent")
        assert not hasattr(box, "git")

        run = await box.exec.command("echo ephemeral-ok")
        assert "ephemeral-ok" in run.result

        await box.files.write(path="e.txt", content="ephemeral")
        assert await box.files.read("e.txt") == "ephemeral"

        await box.exec.command("mkdir -p d")
        await box.cd("d")
        assert box.cwd.endswith("/d")

        status = await box.get_status()
        assert "status" in status
    finally:
        await box.delete()
