"""The plugin against the real ``upstash-box`` SDK, talking to a local Box API (``box_server.py``).

REST calls never leave the process and exec sessions use a real local WebSocket, so these tests
exercise the SDK's own clients, session handle and file transfer without network or credentials.
"""

import time
from pathlib import Path

import pytest

from hermes_box_plugin import upstash_box_env
from hermes_box_plugin.upstash_box_env import UpstashBoxEnvironment


def _env(server, **kwargs):
    kwargs.setdefault("api_key", "test-key-not-real")
    kwargs.setdefault("base_url", server.base_url)
    kwargs.setdefault("timeout", 30)
    return UpstashBoxEnvironment(**kwargs)


@pytest.fixture
def sdk_env(box_server):
    made = []

    def factory(**kwargs):
        env = _env(box_server, **kwargs)
        made.append(env)
        return env

    yield factory
    for env in made:
        env.cleanup()


def test_commands_run_through_real_sessions(box_server, sdk_env):
    env = sdk_env(task_id="t1", persistent=False)
    box = box_server.box(env.box_id)
    assert env.cwd == box["home"]
    result = env.execute("echo out; echo err >&2; exit 3")
    assert result["returncode"] == 3
    assert "out" in result["output"] and "err" in result["output"]
    assert env.execute("cat", stdin_data="über\nline")["output"] == "über\nline"
    session = box_server.sessions[-1]
    assert session.stdin.startswith(b"go\n") and session.stdin_closed
    env.execute("mkdir -p proj && cd proj")
    assert env.execute("pwd")["output"].strip() == f"{box['home']}/proj"


def test_timeout_kills_the_remote_process(box_server, sdk_env):
    env = sdk_env(task_id="t1", persistent=False)
    started = time.monotonic()
    result = env.execute("echo before; sleep 30", timeout=2)
    assert result["returncode"] == 124
    assert "before" in result["output"]
    assert time.monotonic() - started < 15
    assert "KILL" in box_server.sessions[-1].signals


def test_large_output_streams_into_the_bounded_collector(box_server, sdk_env):
    env = sdk_env(task_id="t1", persistent=False)
    command = "head -c 2000000 /dev/zero | tr '\\0' c"
    assert env.execute(command, timeout=60)["output"].strip() == "c" * 2_000_000
    bounded = env.execute(command, timeout=60, bounded_capture=True)
    assert len(bounded["output"]) < 200_000
    assert bounded["output_total_chars"] >= 2_000_000


def test_no_telemetry_headers_and_only_the_configured_endpoint(box_server, sdk_env, monkeypatch):
    monkeypatch.setenv("UPSTASH_BOX_BASE_URL", "https://other-profile.example.test")
    env = sdk_env(task_id="t1")
    env.execute("true")
    env.cleanup()
    assert box_server.requests and box_server.ws_requests
    for request in box_server.requests:
        assert request.url.host == "127.0.0.1"
        assert request.headers.get("x-box-api-key") == "test-key-not-real"
        assert not [h for h in request.headers if h.lower().startswith("upstash-telemetry")]
    for request in box_server.ws_requests:
        assert not [h for h in request.headers if h.lower().startswith("upstash-telemetry")]


def test_files_sync_up_and_back_in_chunks(box_server, monkeypatch, tmp_path):
    host = tmp_path / "host-skills" / "demo" / "SKILL.md"
    host.parent.mkdir(parents=True)
    host.write_text("original\n")
    monkeypatch.setattr(upstash_box_env, "iter_sync_files", lambda base: [(str(host), f"{base}/skills/demo/SKILL.md")])
    monkeypatch.setattr(upstash_box_env, "_READ_CHUNK", 8192)
    env = _env(box_server, task_id="t1", persistent=False)
    box_id = env.box_id
    remote = Path(box_server.box(box_id)["home"]) / ".hermes" / "skills" / "demo" / "SKILL.md"
    assert remote.read_text() == "original\n"  # multipart upload through the SDK
    env.execute("seq 1 30000 > ~/.hermes/skills/demo/SKILL.md")
    env.cleanup()
    assert host.read_text() == "".join(f"{i}\n" for i in range(1, 30001))
    assert len(box_server.reads) > 10  # base64 range reads of the tar archive
    assert box_server.boxes[box_id]["status"] == "deleted"


def test_persistent_box_is_paused_and_resumed_by_name(box_server):
    first = _env(box_server, task_id="t1")
    box_id = first.box_id
    first.execute("echo kept > marker.txt")
    first.cleanup()
    assert box_server.boxes[box_id]["status"] == "paused"
    second = _env(box_server, task_id="t1")
    try:
        assert second.box_id == box_id
        assert box_server.boxes[box_id]["status"] == "running"
        assert second.execute("cat marker.txt")["output"].strip() == "kept"
    finally:
        second.cleanup()


def test_box_deleted_on_the_server_is_replaced(box_server, sdk_env):
    env = sdk_env(task_id="t1", persistent=False)
    old = env.box_id
    box_server.boxes[old]["status"] = "deleted"
    result = env.execute("echo hi")
    assert result["returncode"] == 1 and "no longer exists" in result["output"]
    again = env.execute("echo hi")
    assert again["output"].strip() == "hi" and again.get("environment_recreated") is True
    assert env.box_id != old


def test_dropped_connection_is_a_failure_not_a_result(box_server, sdk_env):
    env = sdk_env(task_id="t1", persistent=False)
    box_server.drop_sessions = True
    result = env.execute("echo never")
    assert result["returncode"] == 1
    assert "session ended before the command exited" in result["output"] or "could not start" in result["output"]
    assert "never" not in result["output"]


def test_cleanup_retries_transient_delete_failures(box_server, monkeypatch):
    monkeypatch.setattr(upstash_box_env, "_CLEANUP_BACKOFF_S", 0)
    env = _env(box_server, task_id="t1", persistent=False)
    box_id = env.box_id
    box_server.failures[("DELETE", "box")] = [503, 500]
    env.cleanup()
    assert box_server.boxes[box_id]["status"] == "deleted" and env.box_id is None


def test_cleanup_keeps_the_box_after_a_permanent_failure(box_server, monkeypatch):
    env = _env(box_server, task_id="t1", persistent=False)
    box_id = env.box_id
    box_server.failures[("DELETE", "box")] = [403]
    env.cleanup()
    assert env.box_id == box_id and box_server.boxes[box_id]["status"] == "running"
    env.cleanup()
    assert box_server.boxes[box_id]["status"] == "deleted" and env.box_id is None


def test_delete_answered_with_404_counts_as_done(box_server):
    env = _env(box_server, task_id="t1", persistent=False)
    box_server.failures[("DELETE", "box")] = [404]
    env.cleanup()
    assert env.box_id is None
