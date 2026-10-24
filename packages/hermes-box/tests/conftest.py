"""Test bootstrap: import the plugin directory as the package ``hermes_box_plugin``, and a fake Box SDK.

The Hermes plugin loader imports a directory plugin as a package (``hermes_plugins.<slug>``) so the
relative imports in ``__init__.py`` resolve; tests mirror that under a stable alias. Hermes core
(``agent``, ``tools``, ``hermes_cli``) must be importable: install a hermes-agent checkout
(``pip install -e``) or put it on ``PYTHONPATH``.

The fake SDK needs no network: its "Box" is a temporary directory on this machine and its exec
sessions are real local ``bash`` processes, so the full BaseEnvironment command path (snapshot,
cwd tracking, stdin, timeouts, kills) runs for real against it.
"""

from __future__ import annotations

import base64
import importlib.util
import itertools
import os
import shutil
import signal
import subprocess
import sys
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest

PACKAGE = "hermes_box_plugin"
_ROOT = Path(__file__).resolve().parents[1]

# ``python -m pytest`` from the plugin dir puts it on sys.path, where its modules could shadow core's.
sys.path[:] = [p for p in sys.path if Path(p or ".").resolve() != _ROOT]


def _load_plugin_package():
    if PACKAGE in sys.modules:
        return sys.modules[PACKAGE]
    spec = importlib.util.spec_from_file_location(
        PACKAGE, _ROOT / "__init__.py", submodule_search_locations=[str(_ROOT)]
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[PACKAGE] = module
    spec.loader.exec_module(module)
    return module


_load_plugin_package()


# Captured before any test runs: unit tests never see real credentials, integration tests ask for them.
_REAL_CONNECTION = {
    key: os.environ[var]
    for key, var in (("api_key", "UPSTASH_BOX_API_KEY"), ("base_url", "UPSTASH_BOX_BASE_URL"))
    if os.environ.get(var)
}


@pytest.fixture(autouse=True)
def _hermes_home(tmp_path, monkeypatch):
    """Every test gets its own profile home, never the real one, and no real Box credentials."""
    home = tmp_path / "hermes"
    home.mkdir()
    monkeypatch.setenv("HERMES_HOME", str(home))
    for var in ("UPSTASH_BOX_API_KEY", "UPSTASH_BOX_BASE_URL"):
        monkeypatch.delenv(var, raising=False)
    return home


@pytest.fixture
def real_connection():
    """``api_key``/``base_url`` for the real Box API; skips the test when no key is configured."""
    if "api_key" not in _REAL_CONNECTION:
        pytest.skip("UPSTASH_BOX_API_KEY is not set")
    return dict(_REAL_CONNECTION)


class _RepoRootIsNotATestPackage:
    """The plugin directory *is* a package (``__init__.py`` with relative imports), so pytest would
    collect it as a test ``Package`` and import that ``__init__.py`` standalone, where the relative
    imports cannot resolve. Collect the root as a plain directory instead."""

    @pytest.hookimpl(tryfirst=True)
    def pytest_collect_directory(self, path, parent):
        if Path(path).resolve() == _ROOT:
            return pytest.Dir.from_parent(parent, path=path)
        return None


def pytest_configure(config):
    if not config.pluginmanager.has_plugin("hermes-box-repo-root"):
        config.pluginmanager.register(_RepoRootIsNotATestPackage(), "hermes-box-repo-root")


# --------------------------------------------------------------------------- fake SDK


class FakeBoxError(Exception):
    def __init__(self, message: str, status_code=None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class FakeSession:
    """``ExecSessionHandle`` stand-in backed by a local process group."""

    def __init__(self, box, argv, on_stdout, on_stderr):
        self.argv = argv
        self.killed_with = []
        self.closed = False
        self.stdin_chunks = []
        self.stdin_closed = False
        self._exit = threading.Event()
        self._code = -1
        self._proc = subprocess.Popen(
            argv,
            cwd=box.home,
            env=box.process_env(),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
        )
        self._pumps = [
            threading.Thread(target=self._pump, args=(self._proc.stdout, on_stdout), daemon=True),
            threading.Thread(target=self._pump, args=(self._proc.stderr, on_stderr), daemon=True),
        ]
        for pump in self._pumps:
            pump.start()
        threading.Thread(target=self._reap, daemon=True).start()

    @staticmethod
    def _pump(stream, callback):
        for chunk in iter(lambda: stream.read1(4096), b""):
            if callback is not None:
                callback(chunk)

    def _reap(self):
        code = self._proc.wait()
        for pump in self._pumps:
            pump.join(timeout=5)
        self._settle(code if code >= 0 else 128 - code)

    def _settle(self, code):
        if not self._exit.is_set():
            self._code = code
            self._exit.set()

    def write(self, data):
        self.stdin_chunks.append(data)
        self._proc.stdin.write(data if isinstance(data, bytes) else data.encode())
        self._proc.stdin.flush()

    def end_stdin(self):
        self.stdin_closed = True
        self._proc.stdin.close()

    def kill(self, sig=None):
        self.killed_with.append(sig)
        with_signal = signal.SIGKILL if sig == "KILL" else signal.SIGTERM
        try:
            os.killpg(self._proc.pid, with_signal)
        except ProcessLookupError:
            pass

    def wait(self, timeout=None):
        if not self._exit.wait(timeout):
            raise TimeoutError("exec.session wait timed out")
        return self._code

    def close(self):
        self.closed = True
        if self._proc.poll() is None:
            self.kill("KILL")
        self._settle(-1)


class _FakeExec:
    def __init__(self, box):
        self._box = box

    def command(self, command):
        self._box.commands.append(command)
        done = subprocess.run(
            ["sh", "-c", command],
            cwd=self._box.home,
            env=self._box.process_env(),
            capture_output=True,
            text=True,
            check=False,
        )
        return SimpleNamespace(
            stdout=done.stdout,
            stderr=done.stderr,
            exit_code=done.returncode,
            result=done.stdout if done.returncode == 0 else done.stderr,
        )

    def session(self, *, argv=None, cmd=None, on_stdout=None, on_stderr=None, **kwargs):
        box = self._box
        if box.status == "paused" and box.refuse_sessions_when_paused:
            raise FakeBoxError("box is paused", 409)
        if box.session_error is not None:
            raise box.session_error
        session = FakeSession(box, argv or ["bash", "-lc", cmd], on_stdout, on_stderr)
        box.sessions.append(session)
        return session


class _FakeFiles:
    def __init__(self, box):
        self._box = box

    def upload(self, files):
        for entry in files:
            self._box.uploads.append(dict(entry))
            shutil.copyfile(entry["path"], entry["destination"])

    def stat(self, path, follow=False):
        return SimpleNamespace(size=os.path.getsize(path), type="file")

    def read(self, path, encoding=None, offset=None, length=None):
        self._box.reads.append((path, offset, length))
        with open(path, "rb") as fh:
            fh.seek(offset or 0)
            data = fh.read() if length is None else fh.read(length)
        return base64.b64encode(data).decode() if encoding == "base64" else data.decode()


class FakeBox:
    def __init__(self, cloud, box_id, name, home, config):
        self.cloud, self.id, self.name, self.home, self.config = cloud, box_id, name, str(home), config
        self.keep_alive = bool(config.get("keep_alive"))
        self.cwd = "/workspace/home"
        self.status = "running"
        self.calls, self.commands, self.uploads, self.reads, self.sessions = [], [], [], [], []
        self.refuse_sessions_when_paused = False
        self.session_error = None
        self.exec = _FakeExec(self)
        self.files = _FakeFiles(self)

    def process_env(self):
        return {"HOME": self.home, "PATH": os.environ.get("PATH", "/usr/bin:/bin"), "LANG": "C.UTF-8"}

    def get_status(self):
        self.calls.append("get_status")
        return {"status": self.status}

    def pause(self):
        self.calls.append("pause")
        if self.keep_alive:
            raise FakeBoxError("Keep-alive boxes cannot be paused")
        self.status = "paused"

    def resume(self):
        self.calls.append("resume")
        self.status = "running"

    def delete(self):
        self.calls.append("delete")
        self.status = "deleted"
        self.cloud.boxes.pop(self.name, None)

    def close(self):
        self.calls.append("close")


class FakeCloud:
    """Stands in for the ``Box`` class: ``create`` and ``get_by_name`` against an in-memory account."""

    Error = FakeBoxError

    def __init__(self, root: Path):
        self.root = root
        self.boxes: dict[str, FakeBox] = {}
        self.created: list[FakeBox] = []
        self.lookups: list[str] = []
        self.connections: list[dict] = []
        self.get_error = None
        self._ids = itertools.count(1)

    def _connection(self, options):
        conn = {k: options.pop(k) for k in ("api_key", "base_url") if k in options}
        self.connections.append(conn)
        return conn

    def get_by_name(self, name, **options):
        self._connection(options)
        self.lookups.append(name)
        if self.get_error is not None:
            raise self.get_error
        if name not in self.boxes:
            raise FakeBoxError(f"box {name} not found", 404)
        return self.boxes[name]

    def create(self, **config):
        self._connection(config)
        box_id = f"box-{next(self._ids)}"
        home = self.root / box_id
        home.mkdir(parents=True)
        box = FakeBox(self, box_id, config["name"], home, config)
        self.boxes[config["name"]] = box
        self.created.append(box)
        return box

    def add_existing(self, name, *, status="paused", **config):
        box = self.create(name=name, **config)
        self.created.remove(box)
        box.status = status
        return box


@pytest.fixture
def cloud(tmp_path, monkeypatch):
    """A fake Upstash Box account wired into the environment module, with sync sources emptied."""
    from hermes_box_plugin import upstash_box_env

    fake = FakeCloud(tmp_path / "boxes")
    monkeypatch.setattr(upstash_box_env, "_load_sdk", lambda: (fake, FakeBoxError))
    monkeypatch.setattr(upstash_box_env, "iter_sync_files", lambda base: [])
    monkeypatch.setattr("tools.environments.base.is_interrupted", lambda: False)
    monkeypatch.setattr("tools.credential_files.get_credential_file_mounts", list)
    return fake


@pytest.fixture
def make_env(cloud):
    from hermes_box_plugin.upstash_box_env import UpstashBoxEnvironment

    made = []

    def factory(**kwargs):
        kwargs.setdefault("api_key", "test-key-not-real")
        env = UpstashBoxEnvironment(**kwargs)
        made.append(env)
        return env

    yield factory
    for env in made:
        env.cleanup()
