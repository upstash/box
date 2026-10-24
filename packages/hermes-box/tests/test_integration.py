"""Opt-in tests against the real Upstash Box API. They create and delete real Boxes (billed to the
account of the key), so they only run with ``UPSTASH_BOX_API_KEY`` set: ``pytest -m integration``."""

import contextlib
import uuid

import pytest

from hermes_box_plugin import upstash_box_env

pytestmark = pytest.mark.integration


@pytest.fixture
def real_env(real_connection, monkeypatch):
    from hermes_box_plugin.upstash_box_env import UpstashBoxEnvironment

    monkeypatch.setattr("tools.credential_files.get_credential_file_mounts", list)
    monkeypatch.setattr(upstash_box_env, "iter_sync_files", lambda base: [])
    made = []

    def factory(**kwargs):
        env = UpstashBoxEnvironment(timeout=120, **real_connection, **kwargs)
        made.append(env)
        return env

    yield factory
    for env in made:
        env.cleanup()


def test_non_persistent_round_trip(real_env):
    env = real_env(task_id=f"it-{uuid.uuid4().hex[:8]}", persistent=False)
    assert env.cwd.startswith("/")
    result = env.execute("echo hello; echo oops >&2; exit 7")
    assert result["returncode"] == 7
    assert "hello" in result["output"] and "oops" in result["output"]
    assert env.execute("cat", stdin_data="from-stdin")["output"] == "from-stdin"
    env.execute("mkdir -p proj && cd proj")
    assert env.execute("pwd")["output"].strip().endswith("/proj")
    timed = env.execute("sleep 60", timeout=3)
    assert timed["returncode"] == 124


def test_sync_round_trip_reads_back_in_several_chunks(real_env, monkeypatch, tmp_path):
    host = tmp_path / "skills" / "demo" / "SKILL.md"
    host.parent.mkdir(parents=True)
    host.write_text("original\n")
    monkeypatch.setattr(upstash_box_env, "iter_sync_files", lambda base: [(str(host), f"{base}/skills/demo/SKILL.md")])
    # Small chunks so the ~400 KB archive comes back in several base64 range reads.
    monkeypatch.setattr(upstash_box_env, "_READ_CHUNK", 64 * 1024)
    env = real_env(task_id=f"it-{uuid.uuid4().hex[:8]}", persistent=False)
    assert env.execute("cat ~/.hermes/skills/demo/SKILL.md")["output"] == "original\n"
    env.execute("seq 1 60000 > ~/.hermes/skills/demo/SKILL.md")
    env.cleanup()
    assert host.read_text() == "".join(f"{i}\n" for i in range(1, 60001))


def test_persistent_box_is_paused_and_resumed_by_name(real_env, real_connection):
    from upstash_box import Box

    task_id = f"it-{uuid.uuid4().hex[:8]}"
    first = real_env(task_id=task_id, persistent=True)
    box_id = first.box_id
    try:
        first.execute("echo kept > ~/marker.txt")
        first.cleanup()
        second = real_env(task_id=task_id, persistent=True)
        assert second.box_id == box_id
        assert second.execute("cat ~/marker.txt")["output"].strip() == "kept"
        second.cleanup()
    finally:
        # Persistent Boxes are only paused by the plugin; this test owns this one and removes it.
        with contextlib.suppress(Exception):
            Box.get(box_id, **real_connection).delete()
