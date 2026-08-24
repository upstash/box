"""Live exec sessions against a real box. Mirrors the `@upstash/box` integration
suite so both SDKs are held to the same server behavior."""

import asyncio

import pytest
import pytest_asyncio

from upstash_box import AsyncBox, BoxError

# One box for the whole module, so the loop must outlive each test.
pytestmark = [pytest.mark.integration, pytest.mark.asyncio(loop_scope="module")]


class Sink:
    """Accumulates decoded output from a session's callbacks."""

    def __init__(self) -> None:
        self.out = ""
        self.err = ""

    def on_stdout(self, data: bytes) -> None:
        self.out += data.decode("utf-8", "replace")

    def on_stderr(self, data: bytes) -> None:
        self.err += data.decode("utf-8", "replace")


@pytest_asyncio.fixture(scope="module", loop_scope="module")
async def box(module_opts):
    created = await AsyncBox.create(**module_opts)
    try:
        yield created
    finally:
        try:
            await created.delete()
        except Exception:
            pass


async def test_streams_stdout_and_stderr_separately_with_exit_code(box):
    sink = Sink()
    session = await box.exec.session(
        argv=["sh", "-c", "echo to-stdout; echo to-stderr 1>&2; exit 42"],
        on_stdout=sink.on_stdout,
        on_stderr=sink.on_stderr,
    )
    assert session.pid > 0
    assert session.exec_id != ""
    assert await session.wait() == 42
    assert sink.out.strip() == "to-stdout"
    assert sink.err.strip() == "to-stderr"


async def test_argv_runs_without_a_shell(box):
    sink = Sink()
    session = await box.exec.session(argv=["echo", "$HOME; rm -rf /"], on_stdout=sink.on_stdout)
    await session.wait()
    # A shell would expand $HOME and treat `;` as a separator.
    assert sink.out.strip() == "$HOME; rm -rf /"


async def test_cmd_runs_through_a_shell(box):
    sink = Sink()
    session = await box.exec.session(cmd="echo shell-$((1+1))", on_stdout=sink.on_stdout)
    await session.wait()
    assert sink.out.strip() == "shell-2"


async def test_stdin_and_end_stdin_finish_an_eof_reading_command(box):
    sink = Sink()
    session = await box.exec.session(argv=["sort"], on_stdout=sink.on_stdout)
    await session.write("banana\napple\ncherry\n")
    await session.end_stdin()

    assert await session.wait() == 0
    assert sink.out == "apple\nbanana\ncherry\n"


async def test_honors_cwd_and_overlays_env(box):
    await box.files.mkdir("session-proj/src", parents=True)
    sink = Sink()
    session = await box.exec.session(
        argv=["sh", "-c", "pwd; echo $MY_VAR"],
        cwd="session-proj/src",
        env=["MY_VAR=from-test"],
        on_stdout=sink.on_stdout,
    )
    await session.wait()

    assert "/workspace/home/session-proj/src" in sink.out
    assert "from-test" in sink.out
    await box.files.remove("session-proj", recursive=True)


async def test_drops_blocked_env_keys_but_passes_ordinary_ones(box):
    sink = Sink()
    session = await box.exec.session(
        argv=["sh", "-c", "echo LD=[$LD_PRELOAD] SAFE=[$SAFE]"],
        env=["LD_PRELOAD=/tmp/evil.so", "SAFE=yes"],
        on_stdout=sink.on_stdout,
    )
    await session.wait()

    assert "LD=[]" in sink.out
    assert "SAFE=[yes]" in sink.out


async def test_terminate_stops_a_long_running_process(box):
    session = await box.exec.session(argv=["sleep", "300"])
    await session.terminate(1000)
    assert await session.wait() != 0


async def test_kill_reaps_the_whole_process_tree(box):
    async def running() -> str:
        run = await box.exec.command(
            'c=0; for d in /proc/[0-9]*; do [ "$(cat "$d/comm" 2>/dev/null)" = "sleep" ] '
            '&& grep -qs 4711 "$d/cmdline" && c=$((c+1)); done; echo $c'
        )
        return run.result.strip()

    session = await box.exec.session(cmd="sleep 4711 & sleep 4712 & wait")
    await asyncio.sleep(0.8)
    assert await running() != "0"

    await session.kill("TERM")
    await session.wait()
    await asyncio.sleep(0.5)
    assert await running() == "0"


async def test_allocates_a_real_pty_at_the_requested_size(box):
    sink = Sink()
    session = await box.exec.session(
        tty=True,
        rows=24,
        cols=80,
        cmd="tty; stty size; read line; echo GOT=$line; exit 0",
        on_stdout=sink.on_stdout,
    )
    await asyncio.sleep(0.4)
    await session.write("hello-pty\n")

    assert await session.wait() == 0
    assert "/dev/pts/" in sink.out
    # Size must be right from the first read, not applied after the process starts.
    assert "24 80" in sink.out
    assert "GOT=hello-pty" in sink.out


async def test_keeps_a_long_lived_process_for_multiple_round_trips(box):
    sink = Sink()
    session = await box.exec.session(argv=["cat"], on_stdout=sink.on_stdout)
    for msg in ("req-1\n", "req-2\n", "req-3\n"):
        await session.write(msg)
        await asyncio.sleep(0.15)
    assert "req-1" in sink.out
    assert "req-2" in sink.out
    assert "req-3" in sink.out

    await session.kill("KILL")
    await session.wait()


async def test_runs_sessions_concurrently_without_crosstalk(box):
    async def worker(n: int):
        sink = Sink()
        session = await box.exec.session(
            argv=["sh", "-c", f"sleep 0.{n}; echo worker-{n}"], on_stdout=sink.on_stdout
        )
        return n, await session.wait(), sink.out.strip()

    for n, code, out in await asyncio.gather(*(worker(n) for n in (1, 2, 3, 4))):
        assert code == 0
        assert out == f"worker-{n}"


async def test_does_not_leak_env_between_sessions(box):
    first = await box.exec.session(argv=["sh", "-c", "export LEAK=nope; true"])
    await first.wait()

    sink = Sink()
    session = await box.exec.session(
        argv=["sh", "-c", "echo LEAK=[$LEAK]"], on_stdout=sink.on_stdout
    )
    await session.wait()
    assert "LEAK=[]" in sink.out


async def test_close_ends_the_session_and_stops_the_process(box):
    session = await box.exec.session(argv=["sleep", "600"])
    pid = session.pid
    await session.close()
    await session.wait()

    await asyncio.sleep(1.5)
    alive = await box.exec.command(f"[ -d /proc/{pid} ] && echo yes || echo no")
    assert alive.result.strip() == "no"


async def test_rejects_empty_command_locally_and_unsupported_signal(box):
    with pytest.raises(BoxError, match="requires cmd or argv"):
        await box.exec.session()

    session = await box.exec.session(argv=["sleep", "60"])
    with pytest.raises(BoxError, match="unsupported signal"):
        await session.kill("BOGUS")
    await session.close()
    await session.wait()


async def test_session_writes_are_visible_to_the_files_api(box):
    session = await box.exec.session(argv=["sh", "-c", "echo written-by-session > session-out.txt"])
    assert await session.wait() == 0

    assert (await box.files.read("session-out.txt")).strip() == "written-by-session"
    assert (await box.files.stat("session-out.txt")).type == "file"
    await box.files.remove("session-out.txt")


async def test_context_manager_tears_the_session_down(box):
    async with await box.exec.session(argv=["sleep", "600"]) as session:
        pid = session.pid
        assert pid > 0
    await session.wait()

    await asyncio.sleep(1.5)
    alive = await box.exec.command(f"[ -d /proc/{pid} ] && echo yes || echo no")
    assert alive.result.strip() == "no"
