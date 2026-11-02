"""UpstashBoxEnvironment against the fake SDK: Box lifecycle, command execution and file sync."""

import logging
import os
import re
import tarfile
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from hermes_box_plugin import upstash_box_env
from hermes_box_plugin.upstash_box_env import DEFAULT_BASE_URL, box_labels, box_name


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
    assert cloud.connections[-1] == {"api_key": "test-key-not-real", "base_url": DEFAULT_BASE_URL}
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


@pytest.mark.parametrize("persistent", [False, True])
def test_env_used_after_cleanup_is_refused_and_creates_no_box(cloud, make_env, persistent):
    # Hermes unregisters an environment before cleaning it up, so a later call comes from a stale
    # reference (a background poller, say). A Box made for it would never be released.
    from tools.environments.base import EnvironmentConnectionError

    env = make_env(task_id="t1", persistent=persistent)
    env.cleanup()
    lookups = len(cloud.lookups)
    with pytest.raises(EnvironmentConnectionError, match="cleaned up"):
        env.execute("echo again")
    assert len(cloud.created) == 1 and len(cloud.lookups) == lookups


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
    argv = box.sessions[-1].argv
    assert argv == ["bash", "-lc", "echo hi"]
    env._run_bash("echo hi", login=False).wait(10)
    assert box.sessions[-1].argv == ["bash", "-c", "echo hi"]


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


def test_kill_while_the_session_opens_is_reported_at_once_and_stops_it(cloud, make_env, monkeypatch):
    env = make_env(task_id="t1")
    box = cloud.created[0]
    entered, release = threading.Event(), threading.Event()
    real_open = env._open_session

    def slow_open(*args):
        entered.set()
        assert release.wait(10)
        return real_open(*args)

    monkeypatch.setattr(env, "_open_session", slow_open)
    before = len(box.sessions)
    proc = env._run_bash("sleep 30")
    assert entered.wait(10), "the worker never reached session start"
    started = time.monotonic()
    proc.kill()
    # The cancel is reported at once, while the session is still being opened.
    assert proc.wait(5) == 130
    assert time.monotonic() - started < 2
    release.set()
    deadline = time.monotonic() + 10
    while (len(box.sessions) == before or not box.sessions[-1].closed) and time.monotonic() < deadline:
        time.sleep(0.01)
    session = box.sessions[-1]
    assert session.closed and session.wait(10) != 0  # stopped, not left to run its 30 s


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
    # One tar archive per batch, unpacked in the Box and then removed there.
    assert len(box.uploads) == 1 and box.uploads[0]["destination"].endswith(".tar")
    assert any(c.startswith("tar xf ") for c in box.commands)
    assert not Path(box.uploads[0]["destination"]).exists()


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


@pytest.mark.parametrize("prefix", ["a" * 60, "b" * 70, "x" * 40, "team-" * 20])
def test_long_prefixes_keep_names_bounded_and_distinct(prefix):
    first, second = box_name(prefix, "task-a"), box_name(prefix, "task-b")
    assert first != second
    for name in (first, second, box_name(prefix, "task-a", unique=True)):
        assert len(name) <= 63, name
        assert re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", name), name


def test_task_ids_that_differ_past_the_kept_part_get_distinct_names():
    base = "t" * 40
    assert box_name("hermes", base + "-one") != box_name("hermes", base + "-two")
    # Fits the 32-character slug limit but not the room a long prefix leaves.
    task = "abcdefghijklmnopqrstuvwxyz-"
    assert box_name("p" * 35, task + "1") != box_name("p" * 35, task + "2")
    assert len(box_name("p" * 35, task + "1")) <= 63


def test_short_names_are_unchanged():
    assert box_name("hermes", "default") == "hermes-default"
    assert box_name("laptop", "t1") == "laptop-t1"


# --- Session lifetime -------------------------------------------------------------------------


def test_non_persistent_box_lives_for_the_session_not_the_turn(cloud, make_env, monkeypatch):
    from agent.chat_completion_helpers import cleanup_task_resources
    from tools import terminal_tool
    from tools.terminal_tool_lifecycle import cleanup_vm, is_persistent_env

    env = make_env(task_id="session-1", persistent=False)
    box = cloud.created[0]
    monkeypatch.setitem(terminal_tool._active_environments, "session-1", env)
    agent = SimpleNamespace(verbose_logging=False)
    assert is_persistent_env("session-1")

    env.execute("echo one > turn1.txt")
    cleanup_task_resources(agent, "session-1")  # end of turn 1
    assert "delete" not in box.calls
    assert env.execute("cat turn1.txt")["output"].strip() == "one"  # turn 2 still sees it
    cleanup_task_resources(agent, "session-1")  # end of turn 2
    assert "delete" not in box.calls and env.box_id == box.id

    cleanup_vm("session-1")  # session close (AIAgent.close)
    assert "delete" in box.calls and box.status == "deleted"
    assert env.box_id is None


def test_persistent_env_is_not_marked_session_scoped(cloud, make_env):
    env = make_env(task_id="t1")
    assert env._persistent is True and env._session_scoped is False


# --- Endpoint, credentials and telemetry ----------------------------------------------------


def test_ambient_base_url_is_never_used(cloud, make_env, monkeypatch):
    # Under profile multiplexing os.environ may hold another profile's endpoint.
    monkeypatch.setenv("UPSTASH_BOX_BASE_URL", "https://other-profile.example.test")
    make_env(task_id="t1")
    assert cloud.connections and all(c["base_url"] == DEFAULT_BASE_URL for c in cloud.connections)


def test_explicit_base_url_is_used(cloud, make_env):
    make_env(task_id="t1", base_url="https://box.example.test")
    assert cloud.connections[-1]["base_url"] == "https://box.example.test"


def test_default_base_url_matches_the_sdk():
    common = pytest.importorskip("upstash_box._common")
    assert DEFAULT_BASE_URL == common.DEFAULT_BASE_URL


def test_missing_api_key_is_refused(cloud, make_env):
    with pytest.raises(RuntimeError, match="no API key"):
        make_env(task_id="t1", api_key="")
    assert cloud.created == [] and cloud.connections == []


def test_sdk_telemetry_is_off_before_any_client_is_built(cloud, make_env):
    common = pytest.importorskip("upstash_box._common")
    assert "UPSTASH_DISABLE_TELEMETRY" not in os.environ
    assert any(key.startswith("Upstash-Telemetry") for key in common.build_headers("k"))  # SDK default
    make_env(task_id="t1")
    assert os.environ["UPSTASH_DISABLE_TELEMETRY"] == "1"
    assert common.build_headers("k") == {"X-Box-Api-Key": "k"}


def test_an_existing_telemetry_setting_is_left_alone(cloud, make_env, monkeypatch):
    monkeypatch.setenv("UPSTASH_DISABLE_TELEMETRY", "yes")
    make_env(task_id="t1")
    assert os.environ["UPSTASH_DISABLE_TELEMETRY"] == "yes"


# --- Stdin failures ---------------------------------------------------------------------------


def _wrap_sessions(box, monkeypatch, wrap):
    real_session = box.exec.session

    def session(**kwargs):
        handle = real_session(**kwargs)
        wrap(handle)
        return handle

    monkeypatch.setattr(box.exec, "session", session)


def test_stdin_that_cannot_be_encoded_is_reported_and_nothing_runs(cloud, make_env):
    env = make_env(task_id="t1")
    box = cloud.created[0]
    before = len(box.sessions)
    result = env.execute("cat > out.txt", stdin_data="bad \ud800 surrogate")
    assert result["returncode"] == 1
    assert result.get("stdin_error")
    assert "stdin write failed" in result["output"]
    assert len(box.sessions) == before
    assert not (Path(box.home) / "out.txt").exists()


def test_failed_stdin_write_still_sends_eof_and_is_reported(cloud, make_env, monkeypatch):
    env = make_env(task_id="t1")
    box = cloud.created[0]

    def wrap(handle):
        real_write, calls = handle.write, []

        def write(data):
            calls.append(data)
            if len(calls) == 2:  # 1: "abcd", 2: fails
                raise cloud.Error("exec-session send failed: connection reset")
            real_write(data)

        handle.write = write

    _wrap_sessions(box, monkeypatch, wrap)
    monkeypatch.setattr(upstash_box_env, "_STDIN_CHUNK", 4)
    started = time.monotonic()
    result = env.execute("cat", stdin_data="abcdefghijkl", timeout=20)
    assert time.monotonic() - started < 10  # EOF still reached cat
    assert box.sessions[-1].stdin_closed
    assert "connection reset" in result["stdin_error"]
    assert result["output"].startswith("abcd") and "stdin write failed" in result["output"]


def test_failed_eof_is_reported(cloud, make_env, monkeypatch):
    env = make_env(task_id="t1")
    box = cloud.created[0]

    def wrap(handle):
        def end_stdin():
            raise cloud.Error("exec-session send failed: broken pipe")

        handle.end_stdin = end_stdin

    _wrap_sessions(box, monkeypatch, wrap)
    result = env.execute("read -r line; echo got:$line; sleep 3", stdin_data="hello\n", timeout=20)
    assert "got:hello" in result["output"]
    assert "broken pipe" in result["stdin_error"]


def test_stdin_left_unread_by_a_finished_command_is_not_an_error(cloud, make_env):
    env = make_env(task_id="t1")
    result = env.execute("true", stdin_data="x" * (1024 * 1024))
    assert result["returncode"] == 0
    assert "stdin_error" not in result


# --- Output buffering -------------------------------------------------------------------------


def test_bounded_capture_limits_streamed_output(cloud, make_env):
    env = make_env(task_id="t1")
    result = env.execute("head -c 5000000 /dev/zero | tr '\\0' a", bounded_capture=True, timeout=60)
    assert result["returncode"] == 0
    assert len(result["output"]) < 200_000
    assert result["output_total_chars"] >= 5_000_000


def test_full_output_is_kept_for_internal_consumers(cloud, make_env):
    env = make_env(task_id="t1")
    result = env.execute("head -c 3000000 /dev/zero | tr '\\0' b", timeout=60)
    assert result["output"].strip() == "b" * 3_000_000


# --- Boxes changed behind Hermes's back -------------------------------------------------------


def test_box_deleted_behind_our_back_is_replaced_on_the_next_command(cloud, make_env):
    env = make_env(task_id="t1", persistent=False)
    old = cloud.created[0]
    cloud.vanish(old)
    result = env.execute("echo hi")
    assert result["returncode"] == 1 and "no longer exists" in result["output"]
    assert "delete" not in old.calls
    again = env.execute("echo hi")
    assert again["output"].strip() == "hi"
    assert again.get("environment_recreated") is True
    assert env.box_id != old.id and len(cloud.created) == 2


def test_persistent_box_deleted_behind_our_back_is_recreated_by_name(cloud, make_env):
    env = make_env(task_id="t1")
    old = cloud.created[0]
    env.execute("mkdir -p sub && cd sub")
    cloud.vanish(old)
    env.execute("true")
    again = env.execute("pwd")
    new = cloud.created[-1]
    assert again.get("environment_recreated") is True
    assert new.name == "hermes-t1" and env.box_id == new.id != old.id
    assert again["output"].strip() == new.home  # the old cwd does not exist in the new Box


def test_box_in_error_state_is_reported_on_command(cloud, make_env):
    env = make_env(task_id="t1")
    box = cloud.created[0]
    box.status, box.session_error = "error", cloud.Error("box unavailable", 409)
    result = env.execute("echo x")
    assert result["returncode"] == 1 and "error state" in result["output"]
    assert env.box_id == box.id and "delete" not in box.calls


# --- Cleanup failures -------------------------------------------------------------------------


def test_transient_delete_failures_are_retried(cloud, make_env, monkeypatch):
    monkeypatch.setattr(upstash_box_env, "_CLEANUP_BACKOFF_S", 0)
    env = make_env(task_id="t1", persistent=False)
    box = cloud.created[0]
    box.delete_errors = [cloud.Error("upstream unavailable", 503), cloud.Error("Request timeout")]
    env.cleanup()
    assert box.calls.count("delete") == 3 and box.status == "deleted"
    assert env.box_id is None


def test_failed_cleanup_keeps_the_box_for_a_retry(cloud, make_env, monkeypatch):
    monkeypatch.setattr(upstash_box_env, "_CLEANUP_BACKOFF_S", 0)
    env = make_env(task_id="t1", persistent=False)
    box = cloud.created[0]
    box.delete_errors = [cloud.Error("forbidden", 403)]
    env.cleanup()
    assert env.box_id == box.id and box.status == "running" and "close" not in box.calls
    env.cleanup()
    assert box.status == "deleted" and env.box_id is None
    assert box.calls.count("delete") == 2


def test_deleting_an_already_deleted_box_counts_as_done(cloud, make_env):
    env = make_env(task_id="t1", persistent=False)
    box = cloud.created[0]
    cloud.vanish(box)
    env.cleanup()
    assert "delete" in box.calls and env.box_id is None


def test_failed_pause_keeps_the_box_for_a_retry(cloud, make_env, monkeypatch):
    monkeypatch.setattr(upstash_box_env, "_CLEANUP_BACKOFF_S", 0)
    env = make_env(task_id="t1")
    box = cloud.created[0]
    box.pause_errors = [cloud.Error("upstream", 502)] * 3
    env.cleanup()
    assert env.box_id == box.id and box.status == "running"
    env.cleanup()
    assert box.status == "paused" and env.box_id is None


# --- Review fixes -------------------------------------------------------------------------------


def test_explicit_absolute_cwd_is_kept_and_commands_run_there(cloud, make_env, tmp_path):
    work = tmp_path / "work"  # exists on any host, unlike /workspace/home
    work.mkdir()
    env = make_env(task_id="t1", cwd=str(work))
    assert env.cwd == str(work)
    assert env.execute("pwd")["output"].strip() == str(work)


def test_workspace_home_is_not_remapped_to_the_box_home(cloud, make_env, monkeypatch):
    # The mapping alone: the shell snapshot, which would cd on this host, is skipped.
    monkeypatch.setattr(upstash_box_env.UpstashBoxEnvironment, "init_session", lambda self: None)
    env = make_env(task_id="t1", cwd="/workspace/home")
    assert env.remote_home != "/workspace/home"
    assert env.cwd == "/workspace/home"


def test_concurrent_persistent_create_attaches_the_winner(cloud, monkeypatch, make_env):
    real_create = cloud.create

    def lose_the_race(**config):
        winner = real_create(**dict(config))  # another Hermes process creates it first ...
        cloud.created.remove(winner)
        return real_create(**config)  # ... so ours is refused: name already in use (409)

    monkeypatch.setattr(cloud, "create", lose_the_race)
    env = make_env(task_id="race")
    assert env.box_id == cloud.boxes["hermes-race"].id
    assert env.execute("echo ok")["output"].strip() == "ok"


def test_name_conflict_in_non_persistent_mode_is_not_attached(cloud, monkeypatch, make_env):
    # A session Box is deleted at session end: attaching someone else's would delete it.
    def conflict(**config):
        raise cloud.Error(f'Box name "{config["name"]}" is already in use', 409)

    monkeypatch.setattr(cloud, "create", conflict)
    with pytest.raises(cloud.Error, match="already in use"):
        make_env(task_id="t1", persistent=False)
    assert cloud.lookups == []


def test_box_limit_is_reported_with_what_to_do(cloud, make_env):
    cloud.box_limit = 1
    make_env(task_id="first")
    with pytest.raises(RuntimeError, match="Box limit") as raised:
        make_env(task_id="second")
    assert "box list --label hermes" in str(raised.value)
    assert cloud.lookups.count("hermes-second") == 1  # not mistaken for a name conflict


def test_keep_alive_is_ignored_for_session_boxes(cloud, make_env, caplog):
    with caplog.at_level(logging.WARNING):
        make_env(task_id="t1", persistent=False, keep_alive=True)
    assert "keep_alive" not in cloud.created[0].config
    assert "keep_alive" in caplog.text or "keep-alive" in caplog.text


class _StalledConnection:
    """A WebSocket whose ``block_write``-th send never completes (the peer stopped reading)."""

    def __init__(self, block_write):
        self.block_write = block_write
        self.sends = 0
        self.blocked = threading.Event()
        self.release = threading.Event()

    def send(self, frame):
        self.sends += 1
        if self.sends == self.block_write:
            self.blocked.set()
            self.release.wait(10)

    def close(self):
        self.release.set()

    def __iter__(self):
        self.release.wait(10)
        return iter(())


@pytest.mark.parametrize("ret", ["kill", "timeout"])
def test_stop_never_waits_behind_a_stalled_stdin_write(cloud, make_env, monkeypatch, ret):
    from upstash_box._exec_session import ExecSessionHandle

    env = make_env(task_id="t1", persistent=False)
    conn = _StalledConnection(block_write=1)
    handle = ExecSessionHandle(conn, 123, "test", None, None)
    monkeypatch.setattr(env, "_open_session", lambda *args: handle)
    try:
        started = time.monotonic()
        if ret == "kill":
            proc = env._run_bash("cat", stdin_data="input")
            assert conn.blocked.wait(5)
            started = time.monotonic()
            proc.kill()  # Hermes's interrupt path: kill() waits behind the stalled send ...
            assert time.monotonic() - started < 0.5  # ... on a helper thread, not here
        else:
            result = env.execute("cat", stdin_data="input", timeout=1)
            assert result["returncode"] == 124
            assert time.monotonic() - started < 5
    finally:
        conn.release.set()


def test_output_waits_for_the_reader_instead_of_being_dropped():
    proc = upstash_box_env._SessionProcess()
    chunk = b"x" * (48 * 1024)
    fed = threading.Event()

    def produce():
        for _ in range(40):  # ~2 MB, far more than the pipe holds
            proc.feed(chunk)
        proc.finish(0, "[end]")
        fed.set()

    threading.Thread(target=produce, daemon=True).start()
    assert not fed.wait(0.5), "feed should wait while nothing reads"
    output = proc.stdout.read()
    assert fed.wait(5) and proc.wait(5) == 0
    assert output == "x" * (40 * len(chunk)) + "[end]"
    proc.stdout.close()


def test_output_is_discarded_once_hermes_stops_reading():
    proc = upstash_box_env._SessionProcess()
    proc.stdout.close()  # Hermes returned (timeout, interrupt) and closed its end
    done = threading.Event()

    def produce():
        for _ in range(100):
            proc.feed(b"z" * (48 * 1024))
        proc.finish(130)
        done.set()

    threading.Thread(target=produce, daemon=True).start()
    assert done.wait(5), "feed must not wait on a reader that is gone"
    assert proc.wait(5) == 130


def test_box_vanishing_during_its_own_setup_fails_the_command_without_hanging(cloud, make_env, monkeypatch):
    env = make_env(task_id="t1", persistent=False)
    cloud.vanish(cloud.created[0])
    assert "no longer exists" in env.execute("echo hi")["output"]
    real_create = cloud.create

    def create_then_vanish(**config):
        box = real_create(**config)
        cloud.vanish(box)  # gone before the shell snapshot can run in it
        return box

    monkeypatch.setattr(cloud, "create", create_then_vanish)
    outcome = {}

    def run():
        try:
            outcome["result"] = env.execute("echo hi", timeout=10)
        except Exception as exc:
            outcome["error"] = exc

    worker = threading.Thread(target=run, daemon=True)
    worker.start()
    worker.join(30)
    assert not worker.is_alive(), "setup recovery hung"
    assert "error" in outcome or outcome["result"]["returncode"] != 0
    monkeypatch.setattr(cloud, "create", real_create)
    assert env.execute("echo back")["output"].strip() == "back"  # the next command recovers


def test_a_cleaned_up_box_is_never_resumed(cloud, make_env):
    # A command that read the Box just before cleanup paused it must not resume it.
    env = make_env(task_id="t1")
    box = cloud.created[0]
    box.refuse_sessions_when_paused = True
    env.cleanup()
    assert box.status == "paused"
    with pytest.raises(upstash_box_env._SessionStartError):
        env._open_session(box, ["true"], lambda data: None)
    assert box.status == "paused" and "resume" not in box.calls


def test_background_process_outlives_its_launch_session(cloud, make_env):
    from tools.process_registry import ProcessRegistry

    env = make_env(task_id="t1")
    registry = ProcessRegistry()
    try:
        session = registry.spawn_via_env(env, "sleep 3; echo bg-done", task_id="bg")
        launcher = cloud.created[0].sessions[-1]
        assert launcher.wait(10) == 0  # the launching command and its session are done
        deadline = time.monotonic() + 30
        while not session.exited and time.monotonic() < deadline:
            time.sleep(0.2)
        assert session.exited and session.exit_code == 0, session.output_buffer
        assert "bg-done" in session.output_buffer
    finally:
        registry.kill_all()


def test_file_sync_uploads_one_archive_per_bounded_batch(cloud, make_env, monkeypatch, tmp_path):
    monkeypatch.setattr(upstash_box_env, "_UPLOAD_BATCH_BYTES", 10)
    env = make_env(task_id="t1")
    box = cloud.created[0]
    before = len(box.uploads)
    files = []
    for name, size in [("a", 4), ("b", 4), ("c", 4), ("big", 25), ("d", 1)]:
        host = tmp_path / name
        host.write_bytes(name.encode() * size)
        files.append((str(host), f"{box.home}/up/{name}"))
    target = tmp_path / "target.md"
    target.write_text("via symlink\n")
    (tmp_path / "link.md").symlink_to(target)
    files.append((str(tmp_path / "link.md"), f"{box.home}/up/nested/link.md"))
    env._bulk_upload(files)
    assert len(box.uploads) - before == 5  # a+b, c, big alone, d, link (each batch one archive)
    for name, size in [("a", 4), ("b", 4), ("c", 4), ("big", 25), ("d", 1)]:
        assert (Path(box.home) / "up" / name).read_bytes() == name.encode() * size
    linked = Path(box.home) / "up" / "nested" / "link.md"
    assert linked.read_text() == "via symlink\n" and not linked.is_symlink()  # contents, not a link
