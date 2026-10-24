"""UpstashBoxEnvironment against the fake SDK: Box lifecycle, command execution and file sync."""

import logging
import re
import tarfile
import time
from pathlib import Path

import pytest

from hermes_box_plugin import upstash_box_env
from hermes_box_plugin.upstash_box_env import box_labels, box_name


def _box(cloud, env):
    return next(b for b in [*cloud.created, *cloud.boxes.values()] if b.id == env.box_id)


def _wait_for_session(box, timeout=10):
    deadline = time.monotonic() + timeout
    while not box.sessions and time.monotonic() < deadline:
        time.sleep(0.01)
    assert box.sessions, "no exec session was opened"
    return box.sessions[-1]


# --- Box lifecycle ----------------------------------------------------------------------------


def test_persistent_creates_named_box_when_none_exists(cloud, make_env):
    env = make_env(task_id="t1", size="medium", runtime="python", labels=["team-a"])
    assert cloud.lookups == ["hermes-t1"]
    assert [b.name for b in cloud.created] == ["hermes-t1"]
    box = cloud.created[0]
    assert box.config == {"name": "hermes-t1", "labels": ["hermes", "team-a"], "size": "medium", "runtime": "python"}
    assert cloud.connections[-1] == {"api_key": "test-key-not-real"}
    assert env.box_id == box.id


def test_persistent_resumes_a_paused_box_by_name(cloud, make_env):
    existing = cloud.add_existing("hermes-t1", status="paused")
    env = make_env(task_id="t1")
    assert cloud.created == []
    assert env.box_id == existing.id
    assert "resume" in existing.calls
    assert env.execute("echo resumed")["output"].strip() == "resumed"


def test_persistent_attaches_a_running_box_without_resuming(cloud, make_env):
    existing = cloud.add_existing("hermes-t1", status="running")
    env = make_env(task_id="t1")
    assert env.box_id == existing.id
    assert "resume" not in existing.calls


def test_lookup_failure_other_than_not_found_is_raised(cloud, make_env):
    cloud.get_error = cloud.Error("unauthorized", 401)
    with pytest.raises(RuntimeError, match="could not look up"):
        make_env(task_id="t1")
    assert cloud.created == []


def test_box_in_error_state_is_reported_not_replaced(cloud, make_env):
    cloud.add_existing("hermes-t1", status="error")
    with pytest.raises(RuntimeError, match="error state"):
        make_env(task_id="t1")
    assert cloud.created == []


def test_cleanup_pauses_in_persistent_mode(cloud, make_env):
    env = make_env(task_id="t1")
    box = cloud.created[0]
    env.cleanup()
    assert "pause" in box.calls and "delete" not in box.calls
    assert box.status == "paused" and "hermes-t1" in cloud.boxes
    env.cleanup()  # idempotent
    assert box.calls.count("pause") == 1


def test_keep_alive_box_is_left_running_on_cleanup(cloud, make_env):
    env = make_env(task_id="t1", keep_alive=True)
    box = cloud.created[0]
    assert box.config["keep_alive"] is True
    env.cleanup()
    assert "pause" not in box.calls and "delete" not in box.calls
    assert box.status == "running"


def test_non_persistent_gets_its_own_box_and_deletes_it(cloud, make_env):
    first = make_env(task_id="t1", persistent=False)
    second = make_env(task_id="t1", persistent=False)
    assert cloud.lookups == []  # never attaches to someone else's Box
    names = [b.name for b in cloud.created]
    assert len(set(names)) == 2 and all(n.startswith("hermes-t1-") for n in names)
    first.cleanup()
    assert "delete" in cloud.created[0].calls
    assert cloud.created[1].status == "running"  # the other session's Box is untouched
    second.cleanup()
    assert cloud.boxes == {}


def test_non_persistent_env_used_after_cleanup_gets_a_fresh_box(cloud, make_env):
    env = make_env(task_id="t1", persistent=False)
    env.cleanup()
    result = env.execute("echo again")
    assert result["output"].strip() == "again"
    assert result.get("environment_recreated") is True
    assert len(cloud.created) == 2


# --- Command execution ------------------------------------------------------------------------


def test_execute_returns_merged_output_and_exit_code(cloud, make_env):
    env = make_env(task_id="t1")
    result = env.execute("echo to-stdout; echo to-stderr >&2; exit 3")
    assert result["returncode"] == 3
    assert "to-stdout" in result["output"] and "to-stderr" in result["output"]


def test_tilde_cwd_resolves_to_the_box_home(cloud, make_env):
    env = make_env(task_id="t1", cwd="~")
    home = cloud.created[0].home
    assert env.cwd == home == env.remote_home
    assert env.execute("pwd")["output"].strip() == home


def test_tilde_subpath_cwd_is_anchored_on_the_box_home(cloud, make_env):
    existing = cloud.add_existing("hermes-t1", status="running")
    (Path(existing.home) / "work").mkdir()
    env = make_env(task_id="t1", cwd="~/work")
    assert env.cwd == f"{existing.home}/work"
    assert env.execute("pwd")["output"].strip() == f"{existing.home}/work"


def test_cd_is_kept_for_later_commands_and_tilde_per_command(cloud, make_env):
    env = make_env(task_id="t1")
    home = cloud.created[0].home
    env.execute("mkdir -p proj && cd proj")
    assert env.cwd == f"{home}/proj"
    assert env.execute("pwd")["output"].strip() == f"{home}/proj"
    assert env.execute("pwd", cwd="~")["output"].strip() == home


def test_stdin_data_is_streamed_and_closed(cloud, make_env):
    env = make_env(task_id="t1")
    result = env.execute("cat", stdin_data="hello\nworld")
    assert result["returncode"] == 0
    assert result["output"] == "hello\nworld"
    assert cloud.created[0].sessions[-1].stdin_closed


def test_stdin_is_closed_even_without_data(cloud, make_env):
    env = make_env(task_id="t1")
    started = time.monotonic()
    result = env.execute("cat; echo done", timeout=20)
    assert result["returncode"] == 0 and "done" in result["output"]
    assert time.monotonic() - started < 10


def test_login_flag_selects_a_login_shell(cloud, make_env):
    env = make_env(task_id="t1")
    box = cloud.created[0]
    env._run_bash("echo hi", login=True).wait(10)
    assert box.sessions[-1].argv[:3] == ["bash", "-l", "-c"]
    env._run_bash("echo hi", login=False).wait(10)
    assert box.sessions[-1].argv[:2] == ["bash", "-c"]


def test_timeout_kills_the_remote_command(cloud, make_env):
    env = make_env(task_id="t1")
    started = time.monotonic()
    result = env.execute("echo before; sleep 30", timeout=2)
    assert result["returncode"] == 124
    assert time.monotonic() - started < 15
    assert "timed out" in result["output"]
    assert "before" in result["output"]  # output so far is kept
    assert "KILL" in cloud.created[0].sessions[-1].killed_with


def test_interrupt_cancels_the_running_session(cloud, make_env):
    env = make_env(task_id="t1")
    box = cloud.created[0]
    before = len(box.sessions)
    proc = env._run_bash("sleep 30")
    deadline = time.monotonic() + 10
    while len(box.sessions) == before and time.monotonic() < deadline:
        time.sleep(0.01)
    session = box.sessions[-1]
    started = time.monotonic()
    proc.kill()
    assert proc.wait(10) == 130
    assert time.monotonic() - started < 10
    assert "KILL" in session.killed_with and session.closed


def test_kill_before_the_session_opens_never_runs_the_command(cloud, make_env, monkeypatch):
    env = make_env(task_id="t1")
    box = cloud.created[0]
    gate = __import__("threading").Event()
    real_open = env._open_session

    def slow_open(*args):
        gate.wait(5)
        return real_open(*args)

    monkeypatch.setattr(env, "_open_session", slow_open)
    before = len(box.sessions)
    proc = env._run_bash("touch should-not-exist")
    proc.kill()
    gate.set()
    assert proc.wait(10) == 130
    time.sleep(0.2)
    assert not (Path(box.home) / "should-not-exist").exists()
    assert all(s.closed for s in box.sessions[before:])


def test_a_box_paused_behind_our_back_is_resumed(cloud, make_env):
    env = make_env(task_id="t1")
    box = cloud.created[0]
    box.status, box.refuse_sessions_when_paused = "paused", True
    assert env.execute("echo ok")["output"].strip() == "ok"
    assert "resume" in box.calls


def test_session_start_failure_is_reported(cloud, make_env):
    env = make_env(task_id="t1")
    cloud.created[0].session_error = cloud.Error("upstream unavailable", 503)
    result = env.execute("echo x")
    assert result["returncode"] == 1
    assert "could not start the command" in result["output"]


def test_api_key_never_reaches_box_commands_or_logs(cloud, make_env, caplog):
    caplog.set_level(logging.DEBUG)
    env = make_env(task_id="t1", api_key="sk-box-secret-value")
    result = env.execute("env")
    assert "sk-box-secret-value" not in result["output"]
    env.cleanup()
    assert "sk-box-secret-value" not in caplog.text
    assert all("sk-box-secret-value" not in c for c in cloud.created[0].commands)


# --- File sync --------------------------------------------------------------------------------


@pytest.fixture
def synced_skill(tmp_path, monkeypatch):
    host = tmp_path / "host-skills" / "demo" / "SKILL.md"
    host.parent.mkdir(parents=True)
    host.write_text("original\n")
    seen = {}

    def files(base):
        seen["base"] = base
        return [(str(host), f"{base}/skills/demo/SKILL.md")]

    monkeypatch.setattr(upstash_box_env, "iter_sync_files", files)
    return host, seen


def test_sync_uploads_hermes_files_under_the_box_home(cloud, make_env, synced_skill):
    host, seen = synced_skill
    make_env(task_id="t1")
    box = cloud.created[0]
    remote = Path(box.home) / ".hermes" / "skills" / "demo" / "SKILL.md"
    assert seen["base"] == f"{box.home}/.hermes"
    assert remote.read_text() == "original\n"
    assert any(c.startswith("mkdir -p ") for c in box.commands)
    assert [u["destination"] for u in box.uploads] == [str(remote)]


def test_cleanup_syncs_changed_files_back_to_the_host(cloud, make_env, synced_skill):
    host, _ = synced_skill
    env = make_env(task_id="t1")
    box = cloud.created[0]
    env.execute("echo changed-in-box > ~/.hermes/skills/demo/SKILL.md")
    env.cleanup()
    assert host.read_text() == "changed-in-box\n"
    assert box.reads, "the tar archive was not read back"
    assert not list(Path("/tmp").glob(f".hermes_sync.{__import__('os').getpid()}.*.tar"))


def test_bulk_download_reads_the_archive_in_chunks(cloud, make_env, monkeypatch, tmp_path):
    env = make_env(task_id="t1")
    box = cloud.created[0]
    payload = Path(box.home) / ".hermes" / "cache" / "blob.bin"
    payload.parent.mkdir(parents=True)
    payload.write_bytes(bytes(range(256)) * 40)
    monkeypatch.setattr(upstash_box_env, "_READ_CHUNK", 4096)
    dest = tmp_path / "out.tar"
    env._bulk_download(dest)
    assert len(box.reads) > 1
    with tarfile.open(dest) as tar:
        member = tar.extractfile(f"{box.home.lstrip('/')}/.hermes/cache/blob.bin")
        assert member.read() == payload.read_bytes()


def test_delete_removes_remote_files(cloud, make_env):
    env = make_env(task_id="t1")
    box = cloud.created[0]
    victim = Path(box.home) / ".hermes" / "old.md"
    victim.parent.mkdir(parents=True)
    victim.write_text("x")
    env._delete([str(victim)])
    assert not victim.exists()


# --- Naming -----------------------------------------------------------------------------------


@pytest.mark.parametrize("task_id", ["default", "Task_ID/42", "x" * 200, "---", "ünïcode sessión"])
def test_box_names_are_safe_and_bounded(task_id):
    name = box_name("hermes", task_id)
    assert re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", name), name
    assert len(name) <= 63
    assert name == box_name("hermes", task_id)  # deterministic: persistent resume finds it again


def test_task_ids_that_slug_alike_get_distinct_names():
    assert box_name("hermes", "a_b") != box_name("hermes", "a.b")
    assert box_name("hermes", "default") == "hermes-default"


def test_unique_names_differ_per_call():
    assert box_name("hermes", "t", unique=True) != box_name("hermes", "t", unique=True)


def test_labels_respect_box_limits():
    labels = box_labels(["a", "a", "hermes", "x" * 21, "b", "c", "d", "e", ""])
    assert labels == ["hermes", "a", "b", "c", "d"]
