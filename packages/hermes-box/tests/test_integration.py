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


def test_interrupt_kills_the_remote_process(real_env):
    import time

    env = real_env(task_id=f"it-{uuid.uuid4().hex[:8]}", persistent=False)
    proc = env._run_bash("echo started > ~/int.txt; sleep 60; echo finished >> ~/int.txt")
    deadline = time.monotonic() + 30
    while env.execute("cat ~/int.txt 2>/dev/null")["output"].strip() != "started":
        assert time.monotonic() < deadline, "the command never started"
        time.sleep(0.5)
    started = time.monotonic()
    proc.kill()
    assert proc.wait(30) == 130
    assert time.monotonic() - started < 15
    time.sleep(2)
    assert env.execute("pgrep -f 'sleep 6[0]' || echo none")["output"].strip() == "none"
    assert env.execute("cat ~/int.txt")["output"].strip() == "started"


def test_partial_stdin_read_keeps_the_rest_for_the_command(real_env):
    env = real_env(task_id=f"it-{uuid.uuid4().hex[:8]}", persistent=False)
    result = env.execute('read -r a; read -r b; echo "$a|$b"; cat', stdin_data="one\ntwo\nrest\n")
    assert result["returncode"] == 0
    assert result["output"] == "one|two\nrest\n"


def test_box_deleted_outside_hermes_is_replaced(real_env, real_connection):
    from upstash_box import Box

    env = real_env(task_id=f"it-{uuid.uuid4().hex[:8]}", persistent=False)
    old_id = env.box_id
    Box.get(old_id, **real_connection).delete()
    first = env.execute("echo hi")
    second = first if first["returncode"] == 0 else env.execute("echo hi")
    assert second["output"].strip() == "hi"
    assert env.box_id != old_id


def test_large_output_comes_back_complete(real_env):
    env = real_env(task_id=f"it-{uuid.uuid4().hex[:8]}", persistent=False)
    result = env.execute("seq 1 300000")
    assert result["returncode"] == 0
    assert result["output"] == "".join(f"{i}\n" for i in range(1, 300001))
