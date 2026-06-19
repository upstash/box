"""Git operations against a real public repo (no push/PR — those need a token)."""

import pytest

from upstash_box import AsyncBox

pytestmark = pytest.mark.integration


async def test_clone_status_commit_exec(opts):
    box = await AsyncBox.create(runtime="node", **opts)
    try:
        await box.git.clone(repo="https://github.com/octocat/Hello-World")
        await box.cd("Hello-World")

        status = await box.git.status()
        assert isinstance(status, str)

        # Make a change -> shows up in status/diff.
        await box.files.write(path="NEWFILE.txt", content="added by box")
        status2 = await box.git.status()
        assert "NEWFILE.txt" in status2

        # Stage + commit via the box's default identity.
        await box.git.exec(args=["add", "."])
        commit = await box.git.commit(message="chore: add file from box")
        assert commit.sha
        assert "add file" in commit.message

        log = await box.git.exec(args=["log", "--oneline", "-1"])
        assert "add file" in log

        # checkout an existing branch
        await box.git.exec(args=["branch", "feature-x"])
        await box.git.checkout(branch="feature-x")
        branch = await box.git.exec(args=["rev-parse", "--abbrev-ref", "HEAD"])
        assert "feature-x" in branch
    finally:
        await box.delete()
