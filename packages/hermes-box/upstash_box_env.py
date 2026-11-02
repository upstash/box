"""Upstash Box execution environment.

Runs Hermes commands in an Upstash Box through the ``upstash-box`` Python SDK. Every command
runs in a live exec session (``box.exec.session``) so stdin can be streamed in and an interrupt
or timeout can signal the remote process tree. Persistent mode resumes a Box by name and pauses
it on cleanup; non-persistent mode creates a Box for the session and deletes it on cleanup.
"""

from __future__ import annotations

import base64
import contextlib
import hashlib
import logging
import os
import re
import shlex
import socket
import tarfile
import threading
import time
import uuid
from collections import deque
from pathlib import Path
from typing import Any, Callable, Optional

from hermes_constants import get_hermes_home
from tools.environments.base import BaseEnvironment

try:
    from tools.environments.base import EnvironmentConnectionError
except ImportError:  # older Hermes: same shape, reported as an ordinary tool failure

    class EnvironmentConnectionError(RuntimeError):  # type: ignore[no-redef]
        def __init__(self, reason: str, *, retry_hint: str = ""):
            super().__init__(reason)
            self.reason, self.retry_hint = reason, retry_hint


try:
    from hermes_constants import reset_hermes_home_override, set_hermes_home_override
except ImportError:  # older Hermes has no per-context profile homes: the process home is the profile
    set_hermes_home_override = reset_hermes_home_override = None  # type: ignore[assignment]

from tools.environments.file_sync import (
    FileSyncManager,
    iter_sync_files,
    quoted_mkdir_command,
    quoted_rm_command,
    unique_parent_dirs,
)

logger = logging.getLogger(__name__)

API_KEY_ENV = "UPSTASH_BOX_API_KEY"
BASE_URL_ENV = "UPSTASH_BOX_BASE_URL"
# The SDK's own default endpoint (``upstash_box._common.DEFAULT_BASE_URL``). It is always passed
# explicitly: given no ``base_url`` the SDK reads UPSTASH_BOX_BASE_URL from the process
# environment, which under profile multiplexing can belong to another profile.
DEFAULT_BASE_URL = "https://us-east-1.box.upstash.com"
# Presence of this variable turns off the SDK's anonymous telemetry headers.
TELEMETRY_OPT_OUT_ENV = "UPSTASH_DISABLE_TELEMETRY"
DEFAULT_HOME = "/workspace/home"
BASE_LABEL = "hermes"

# Box API limits: at most 5 labels per Box, each at most 20 characters.
_MAX_LABELS = 5
_MAX_LABEL_LEN = 20
_MAX_NAME_LEN = 63
# Longest name prefix kept, so a task part and its hash always fit in a name.
_MAX_PREFIX_LEN = 40
# Task slugs longer than this are shortened (and get a hash).
_MAX_TASK_SLUG_LEN = 32
_HASH_LEN = 8
# files.read caps a bounded range at 8 MiB; stay well under it.
_READ_CHUNK = 4 * 1024 * 1024
# The SDK reads every file of an upload into memory and posts them in one request, so file sync
# uploads in batches of at most this many bytes (a larger single file goes alone).
_UPLOAD_BATCH_BYTES = 32 * 1024 * 1024
# Stdin is sent as session frames; keep each frame small.
_STDIN_CHUNK = 256 * 1024
# Extra seconds the session wait allows past the command timeout. The base class enforces
# the timeout itself (it kills the handle); this only bounds a wedged connection.
_WAIT_GRACE_S = 15
# Output received but not yet handed to Hermes's reader. Past it, the SDK reader thread waits for
# room (backpressure on the WebSocket) instead of dropping bytes, so output is never lost.
_MAX_PENDING_OUTPUT = 8 * 1024 * 1024
# A stop first asks the Box to kill the process and closes the session. If that does not finish in
# this many seconds (a stalled WebSocket write holds the SDK's send lock), the socket is shut down.
_STOP_GRACE_S = 1.0
# The remote command waits for this line on stdin before it starts (see ``_GATE_SCRIPT``).
_GATE_LINE = b"go\n"
# Runs first in every session. It reads one line from stdin and only then execs the real
# command (``$1``), so nothing model-authored runs until Hermes has registered the handle and
# rechecked cancellation (see ``_SessionProcess.poll``). bash's ``read`` takes a pipe byte by byte,
# so the rest of stdin is left for the command. A session closed without the line exits 125
# without running anything.
_GATE_SCRIPT = 'IFS= read -r _hermes_gate || exit 125; [ "$_hermes_gate" = go ] || exit 125; exec bash {flags} "$1"'
# Cleanup retries a transient pause/delete failure this many times in total.
_CLEANUP_ATTEMPTS = 3
_CLEANUP_BACKOFF_S = 0.5


def _load_sdk():
    """``(Box, BoxError)`` from the ``upstash-box`` SDK. Tests replace this with a fake."""
    from upstash_box import Box, BoxError

    return Box, BoxError


def _disable_sdk_telemetry() -> None:
    """Turn off the SDK's anonymous telemetry headers (SDK version, Python version, platform).

    The SDK reads the opt-out when a client is built, so this runs before every ``create`` and
    ``get_by_name``. It only sets the variable when it is unset, as Hermes does for the Vercel
    SDK, and changes nothing else in the environment."""
    os.environ.setdefault(TELEMETRY_OPT_OUT_ENV, "1")


def _sync_back_cap() -> Optional[int]:
    """Hermes's sync-back size cap (``terminal.sync_back_max_bytes``), or None when unknown."""
    try:
        from tools.environments.file_sync import _sync_back_max_bytes

        return int(_sync_back_max_bytes())
    except Exception:  # older Hermes, or an unreadable config: Hermes applies its own check
        return None


def _slug(value: str) -> str:
    return re.sub(r"-{2,}", "-", re.sub(r"[^a-z0-9-]", "-", value.lower())).strip("-")


def box_name(prefix: str, task_id: str, *, unique: bool = False) -> str:
    """Box name for a task: ``<prefix>-<task slug>`` in ``[a-z0-9-]``, at most 63 characters.

    The prefix is cut to 40 characters. A task id that had to be changed or shortened to fit gets
    a short hash of the original, so two task ids never share a Box because of the cut.
    ``unique`` adds a random suffix (one Box per session in non-persistent mode)."""
    prefix = _slug(prefix)[:_MAX_PREFIX_LEN].strip("-") or BASE_LABEL
    slug = _slug(task_id) or "default"
    digest = "-" + hashlib.sha256(task_id.encode("utf-8")).hexdigest()[:_HASH_LEN]
    rand = "-" + uuid.uuid4().hex[:8] if unique else ""
    hashed = slug != task_id or len(slug) > _MAX_TASK_SLUG_LEN
    if hashed:
        slug = slug[:_MAX_TASK_SLUG_LEN].rstrip("-")

    def room(with_hash: bool) -> int:
        return _MAX_NAME_LEN - len(prefix) - 1 - len(rand) - (len(digest) if with_hash else 0)

    if len(slug) > room(hashed):
        hashed = True
    slug = slug[: room(hashed)].rstrip("-") or "t"
    return f"{prefix}-{slug}{digest if hashed else ''}{rand}"


def box_labels(extra: Optional[list] = None) -> list[str]:
    """``hermes`` plus valid user labels, de-duplicated, within the Box label limits."""
    labels = [BASE_LABEL]
    for label in extra or []:
        label = str(label).strip()
        if not label or label in labels:
            continue
        if len(label) > _MAX_LABEL_LEN:
            logger.warning("Upstash Box: label %r is longer than %d characters; skipped", label, _MAX_LABEL_LEN)
            continue
        if len(labels) >= _MAX_LABELS:
            logger.warning("Upstash Box: at most %d labels per Box; %r skipped", _MAX_LABELS, label)
            continue
        labels.append(label)
    return labels


def _status_of(box: Any) -> str:
    try:
        return str((box.get_status() or {}).get("status") or "")
    except Exception as exc:  # status is advisory; exec reports real failures
        logger.debug("Upstash Box: status check failed: %s", exc)
        return ""


def _box_state(box: Any) -> str:
    """The Box's status, ``"gone"`` when the API confirms it no longer exists (404 or ``deleted``),
    or ``""`` when the status could not be read."""
    try:
        status = str((box.get_status() or {}).get("status") or "")
    except Exception as exc:
        if getattr(exc, "status_code", None) == 404:
            return "gone"
        logger.debug("Upstash Box: status check failed: %s", exc)
        return ""
    return "gone" if status == "deleted" else status


def _transient(exc: BaseException) -> bool:
    """A failure worth retrying: no HTTP status (network, timeout), 429 or 5xx."""
    code = getattr(exc, "status_code", None)
    return code is None or code == 429 or code >= 500


def _is_name_conflict(exc: BaseException) -> bool:
    """409 ``Box name "..." is already in use``: another process created this Box first."""
    return getattr(exc, "status_code", None) == 409 and "already in use" in str(exc).lower()


def _is_box_limit(exc: BaseException) -> bool:
    """``Box limit reached``: the account has as many Boxes as its plan allows (paused ones count)."""
    return "box limit" in str(exc).lower()


def _abort_transport(handle: Any) -> None:
    """Shut down the session's socket. A write stalled in ``sendall`` then fails at once and the
    SDK's send lock is released; the Box kills the process when the connection drops. The SDK has
    no public abort, so this reaches its WebSocket (``websockets.sync``) through ``_conn.socket``."""
    sock = getattr(getattr(handle, "_conn", None), "socket", None)
    if sock is not None:
        with contextlib.suppress(OSError):
            sock.shutdown(socket.SHUT_RDWR)


def _stop_session(handle: Any) -> None:
    """Kill the remote process and close the session without blocking the caller.

    ``kill`` and ``close`` can block behind a stalled write (``kill`` waits for the SDK's send lock,
    ``close`` for the WebSocket's), and the caller is Hermes's interrupt or timeout path. Both run on
    a helper thread; if they have not finished after ``_STOP_GRACE_S`` the socket is shut down."""

    def graceful() -> None:
        with contextlib.suppress(Exception):
            handle.kill("KILL")
        with contextlib.suppress(Exception):
            handle.close()  # closing the session also kills the process

    def run() -> None:
        worker = threading.Thread(target=graceful, name="upstash-box-stop", daemon=True)
        worker.start()
        worker.join(_STOP_GRACE_S)
        if worker.is_alive():
            _abort_transport(handle)
            with contextlib.suppress(Exception):
                handle.close()

    threading.Thread(target=run, name="upstash-box-stop-watch", daemon=True).start()


class _SessionStartError(Exception):
    def __init__(self, state: str, cause: BaseException):
        super().__init__(str(cause))
        self.state = state
        self.cause = cause


class _SessionProcess:
    """``ProcessHandle`` for one exec session, with output streamed as it arrives.

    The SDK calls ``feed`` on its WebSocket reader thread. ``feed`` appends to a bounded queue; when
    the queue is full it waits for room, which pushes back on the WebSocket rather than dropping
    output. A writer thread moves the queue into a pipe that Hermes's drain thread reads into its own
    collector, which applies ``bounded_capture`` (or keeps everything for internal consumers). Once
    Hermes stops reading (the pipe is closed) the writer discards, so ``feed`` never waits forever.
    ``poll()`` reports the exit only after every byte has reached the pipe.
    """

    def __init__(self, cancel_fn: Callable[[], None]):
        read_fd, self._write_fd = os.pipe()
        self._stdout = os.fdopen(read_fd, "r", encoding="utf-8", errors="replace")
        self._cancel_fn = cancel_fn
        # Set once the caller is ready for the command to run (see ``poll``); the worker sends the
        # start line only after it. ``_spawn_tid`` is the thread that called ``_run_bash``.
        self.admitted = threading.Event()
        self._spawn_tid = threading.get_ident()
        self._spawn_polls = 0
        self._cond = threading.Condition()
        self._chunks: deque[bytes] = deque()
        self._pending = 0
        self._ended = False
        self._code: Optional[int] = None
        self._trailer = ""
        self._returncode: Optional[int] = None
        self._done = threading.Event()
        # Read by BaseEnvironment._wait_for_process and reported as ``stdin_error``.
        self._hermes_stdin_errors: list[BaseException] = []
        threading.Thread(target=self._write_loop, name="upstash-box-output", daemon=True).start()

    # SDK side
    def feed(self, data: Any) -> None:
        if not data:
            return
        if not isinstance(data, bytes):
            data = str(data).encode("utf-8", "replace")
        with self._cond:
            # Wait for room. An oversized chunk is let through once the queue is empty.
            while self._pending and self._pending + len(data) > _MAX_PENDING_OUTPUT and not self._ended:
                self._cond.wait()
            if self._ended:
                return
            self._chunks.append(data)
            self._pending += len(data)
            self._cond.notify()

    def finish(self, code: int, trailer: str = "") -> None:
        """Record the result. The first call wins; output fed afterwards is ignored."""
        with self._cond:
            if self._ended:
                return
            self._ended = True
            self._code = code
            self._trailer = trailer
            self._cond.notify_all()

    def _write_loop(self) -> None:
        broken = False

        def write(data: bytes) -> None:
            nonlocal broken
            view = memoryview(data)
            while view and not broken:
                try:
                    written = os.write(self._write_fd, view)
                except OSError:  # the reader went away; nothing left to deliver to
                    broken = True
                    return
                view = view[written:]

        try:
            while True:
                with self._cond:
                    while not self._chunks and not self._ended:
                        self._cond.wait()
                    chunk = self._chunks.popleft() if self._chunks else None
                    last = chunk is None and self._ended
                if chunk is not None:
                    write(chunk)  # returns at once when the reader is gone
                    with self._cond:
                        self._pending -= len(chunk)
                        self._cond.notify_all()  # room for a waiting ``feed``
                if last:
                    if self._trailer:
                        write(self._trailer.encode("utf-8", "replace"))
                    break
        finally:
            with contextlib.suppress(OSError):
                os.close(self._write_fd)
            self._returncode = self._code if self._code is not None else 1
            self._done.set()

    # ProcessHandle side
    @property
    def stdout(self):
        return self._stdout

    @property
    def returncode(self) -> Optional[int]:
        return self._returncode

    def poll(self) -> Optional[int]:
        # Hermes registers the handle when ``_run_bash`` returns, then waits on the same thread with
        # ``while proc.poll() is None: <interrupt check>; <deadline check>; sleep``. That thread's
        # second ``poll`` therefore comes after one full interrupt check, so an interrupt that was
        # already pending kills the command before its start line is sent. Polls from other
        # threads (Hermes's output drain) do not count.
        if not self.admitted.is_set() and threading.get_ident() == self._spawn_tid:
            self._spawn_polls += 1
            if self._spawn_polls >= 2:
                self.admitted.set()
        return self._returncode if self._done.is_set() else None

    def kill(self) -> None:
        with contextlib.suppress(Exception):
            self._cancel_fn()
        self.admitted.set()  # wake the worker; it sees the cancel and never starts the command

    def wait(self, timeout: Optional[float] = None) -> Optional[int]:
        self.admitted.set()  # a caller blocking on the result is ready for the command to run
        self._done.wait(timeout)
        return self._returncode


class UpstashBoxEnvironment(BaseEnvironment):
    """Hermes commands in an Upstash Box.

    Each command is one exec session behind a ``_SessionProcess``; its ``kill()`` closes the
    session, which kills the remote process tree, and that is how interrupts and timeouts stop a
    command. Merged stdout and stderr stream back in arrival order.
    """

    _stdin_mode = "payload"
    # A timed-out probe kills only its own session, never the Box (passwordless sudo works there).
    _passwordless_sudo_probe_supported = True

    def __init__(
        self,
        *,
        cwd: str = "~",
        timeout: int = 60,
        task_id: str = "default",
        persistent: bool = True,
        size: str = "small",
        runtime: Optional[str] = None,
        keep_alive: bool = False,
        labels: Optional[list] = None,
        name_prefix: str = BASE_LABEL,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ):
        if not api_key:
            # The SDK would otherwise read UPSTASH_BOX_API_KEY from the process environment.
            raise RuntimeError(f"Upstash Box: no API key ({API_KEY_ENV}) was provided.")
        super().__init__(cwd=cwd, timeout=timeout)
        self._requested_cwd = cwd
        self._persistent = bool(persistent)
        # Hermes tears down environments that are neither persistent nor session-scoped after
        # every turn. A non-persistent Box lives for the session and is deleted at its end.
        self._session_scoped = not self._persistent
        self._task_id = task_id
        self._size = size or "small"
        self._runtime = runtime or None
        self._keep_alive = bool(keep_alive)
        if self._keep_alive and not self._persistent:
            # A keep-alive Box is billed monthly; one per session, deleted at its end, is never wanted.
            logger.warning(
                "Upstash Box: terminal.upstash_box_keep_alive only applies with container_persistent: true; "
                "this session's Box is created without keep-alive"
            )
            self._keep_alive = False
        self._labels = box_labels(labels)
        self._name_prefix = name_prefix or BASE_LABEL
        # Credentials stay in this object only; they are never logged or sent into the Box.
        self._conn: dict[str, str] = {"api_key": api_key, "base_url": base_url or DEFAULT_BASE_URL}
        self._lock = threading.Lock()
        # Guards ``_box`` swaps from command threads; never held across a blocking call.
        self._box_lock = threading.Lock()
        self._box: Any = None
        self._created = False
        self._setup_tid: Optional[int] = None  # the thread inside ``_set_up``, if any
        # Set by cleanup(). Hermes unregisters an environment before cleaning it up, so a later call
        # comes from a stale reference; it is refused rather than given a Box nothing would release.
        self._closed = False
        self._remote_home = DEFAULT_HOME
        self._sync_manager: Optional[FileSyncManager] = None
        # The profile that created this environment. Hermes can clean it up from another thread (the
        # idle reaper) whose profile is the process default; sync-back must still use this one.
        self._owner_home = get_hermes_home()
        # Files from the last sync, enumerated in the owner's context (see ``_sync_files``).
        self._last_sync_files: list[tuple[str, str]] = []
        self._replay_sync_files = False

        self._set_up(recreated=False)

    # --- Box lifecycle ---
    @property
    def box_id(self) -> Optional[str]:
        return getattr(self._box, "id", None)

    @property
    def remote_home(self) -> str:
        return self._remote_home

    def _find(self, Box: Any, BoxError: Any, name: str) -> Any:
        """This task's existing Box by name, resumed if paused, or None when there is none."""
        try:
            box = Box.get_by_name(name, **self._conn)
        except BoxError as exc:
            if getattr(exc, "status_code", None) != 404:
                raise RuntimeError(f"Upstash Box: could not look up Box {name!r}: {exc}") from exc
            return None
        status = _status_of(box)
        if status == "error":
            with contextlib.suppress(Exception):
                box.close()
            raise RuntimeError(
                f"Upstash Box: Box {name!r} is in the error state. Delete it in the Upstash "
                "console (or with `box delete`) and Hermes will create a new one."
            )
        if status == "deleted":
            with contextlib.suppress(Exception):
                box.close()
            return None
        if status == "paused":
            box.resume()
        logger.info("Upstash Box: resumed Box %s (%s) for task %s", name, box.id, self._task_id)
        return box

    def _create(self, Box: Any, BoxError: Any, name: str) -> Any:
        create: dict[str, Any] = {"name": name, "labels": list(self._labels), "size": self._size}
        if self._runtime:
            create["runtime"] = self._runtime
        if self._keep_alive:
            create["keep_alive"] = True
        try:
            return Box.create(**create, **self._conn)
        except BoxError as exc:
            if _is_box_limit(exc):
                raise RuntimeError(
                    f"Upstash Box: your account has reached its Box limit ({exc}). Paused Boxes count "
                    "toward it, and persistent mode keeps one Box per task. Delete Boxes you no longer "
                    "need (`box list --label hermes`, then `box delete <id>`) or upgrade your plan."
                ) from exc
            raise

    def _attach(self) -> None:
        """Resume this task's Box (persistent) or create one, then resolve home and file sync."""
        _disable_sdk_telemetry()
        Box, BoxError = _load_sdk()
        box = None
        self._created = False
        if self._persistent:
            name = box_name(self._name_prefix, self._task_id)
            box = self._find(Box, BoxError, name)
        else:
            name = box_name(self._name_prefix, self._task_id, unique=True)
        if box is None:
            try:
                box = self._create(Box, BoxError, name)
                self._created = True
                logger.info("Upstash Box: created Box %s (%s) for task %s", name, box.id, self._task_id)
            except BoxError as exc:
                # Another Hermes process created this task's Box between our lookup and create.
                if not (self._persistent and _is_name_conflict(exc)):
                    raise
                box = self._find(Box, BoxError, name)
                if box is None:
                    raise
        with self._box_lock:
            self._box = box
        self._remote_home = self._detect_home()
        # ``~`` (Hermes's default for this backend) is the Box user's home; an explicit path is kept.
        if self._requested_cwd in {"~", ""}:
            self.cwd = self._remote_home
        elif self._requested_cwd.startswith("~/"):
            self.cwd = f"{self._remote_home.rstrip('/')}/{self._requested_cwd[2:]}"
        else:
            self.cwd = self._requested_cwd
        container_base = f"{self._remote_home.rstrip('/')}/.hermes"
        self._sync_manager = FileSyncManager(
            get_files_fn=lambda: self._sync_files(container_base),
            upload_fn=self._upload,
            delete_fn=self._delete,
            bulk_upload_fn=self._bulk_upload,
            bulk_download_fn=self._bulk_download,
        )

    def _sync_files(self, container_base: str) -> list[tuple[str, str]]:
        """Host/remote pairs for file sync. Uploads enumerate them in the calling session, the one
        that owns this environment. Sync-back replays the last upload's list instead: it can run on
        another thread, where the profile home and the session's registered credential files differ,
        and a Box's changed files must only ever be mapped onto the files that were pushed to it."""
        if self._replay_sync_files:
            return list(self._last_sync_files)
        files = list(iter_sync_files(container_base))
        self._last_sync_files = files
        return files

    def _sync_back(self) -> None:
        """``sync_back`` in the owning profile: its home for the lock and for host paths."""
        self._replay_sync_files = True
        token = set_hermes_home_override(self._owner_home) if set_hermes_home_override else None
        try:
            self._sync_manager.sync_back(hermes_home=self._owner_home)
        finally:
            if token is not None:
                reset_hermes_home_override(token)
            self._replay_sync_files = False

    def _detect_home(self) -> str:
        fallback = getattr(self._box, "cwd", None) or DEFAULT_HOME
        try:
            run = self._box.exec.command('printf %s "$HOME"')
            home = (run.stdout or "").strip()
        except Exception as exc:
            logger.debug("Upstash Box: home detection failed: %s", exc)
            return fallback
        return home if home.startswith("/") else fallback

    def _ensure_box(self) -> Any:
        """The attached Box, attaching a new one when the last was found deleted. Caller holds ``_lock``."""
        if self._closed:
            raise EnvironmentConnectionError(
                "Upstash Box: this environment was cleaned up and has no Box any more.",
                retry_hint="Retry the command; Hermes starts a new Upstash Box environment for it.",
            )
        if self._box is None:
            # The Box was found deleted: attach anew. A newly created Box is an empty workspace,
            # and the model is told so. The shell snapshot lived in the old Box.
            self._set_up(recreated=True)
        return self._box

    def _set_up(self, *, recreated: bool) -> None:
        """Attach a Box, sync files and take the shell snapshot, once.

        The snapshot runs commands. If the Box disappears meanwhile, those commands must not try to
        attach yet another one from inside this setup (``_current_box`` would wait on ``_lock``,
        which this thread may hold, and retries would nest without bound). They fail instead, and
        the next command starts a fresh setup."""
        self._setup_tid = threading.get_ident()
        try:
            self._attach()
            if recreated and self._created:
                self._mark_recreated()
            self._sync_manager.sync(force=True)
            self._snapshot_ready = False
            self.init_session()
        finally:
            self._setup_tid = None
        if self._box is None:
            raise EnvironmentConnectionError(
                "Upstash Box: the Box disappeared while it was being set up.",
                retry_hint="Retry the command; Hermes sets up a new Box for it.",
            )

    def _forget_box(self, box: Any) -> None:
        """Drop a Box the API reports as gone, so the next command attaches a new one. Nothing is
        deleted: the Box no longer exists."""
        with self._box_lock:
            if self._box is not box:
                return
            self._box = None
        with contextlib.suppress(Exception):
            box.close()
        logger.warning("Upstash Box: Box %s no longer exists; the next command gets a new one", getattr(box, "id", "?"))

    def _current_box(self) -> Any:
        """The Box for a command. ``execute`` attached it in ``_before_execute``; a command started
        another way (a probe) attaches under the lock here, never outside it."""
        with self._box_lock:
            box = self._box
        if box is not None and not self._closed:
            return box
        if self._setup_tid == threading.get_ident():
            raise EnvironmentConnectionError("Upstash Box: the Box disappeared while it was being set up.")
        with self._lock:
            return self._ensure_box()

    def _before_execute(self) -> None:
        with self._lock:
            self._ensure_box()
        if self._sync_manager is not None:
            self._sync_manager.sync()

    # --- Shell helpers (internal, never model-authored) ---
    def _sh(self, script: str, label: str) -> str:
        run = self._box.exec.command(script)
        if run.exit_code != 0:
            detail = (run.stderr or run.stdout or "").strip()
            raise RuntimeError(f"Upstash Box {label} failed (exit {run.exit_code}): {detail}")
        return run.stdout or ""

    # --- File sync transport ---
    def _upload(self, host_path: str, remote_path: str) -> None:
        self._bulk_upload([(host_path, remote_path)])

    def _bulk_upload(self, files: list[tuple[str, str]]) -> None:
        if not files:
            return
        parents = unique_parent_dirs(files)
        if parents:
            self._sh(quoted_mkdir_command(parents), "mkdir")
        batch: list[dict[str, str]] = []
        batch_bytes = 0
        for host, remote in files:
            try:
                size = os.path.getsize(host)
            except OSError:
                size = 0  # the SDK's own open() reports a missing file
            if batch and batch_bytes + size > _UPLOAD_BATCH_BYTES:
                self._box.files.upload(batch)
                batch, batch_bytes = [], 0
            batch.append({"path": host, "destination": remote})
            batch_bytes += size
        if batch:
            self._box.files.upload(batch)

    def _delete(self, remote_paths: list[str]) -> None:
        if remote_paths:
            self._sh(quoted_rm_command(remote_paths), "delete")

    def _bulk_download(self, dest: Path) -> None:
        """Write the remote ``~/.hermes`` as a tar archive to ``dest`` (read back in base64 chunks)."""
        hermes_dir = f"{self._remote_home.rstrip('/')}/.hermes"
        remote_tar = f"/tmp/.hermes_sync.{os.getpid()}.{uuid.uuid4().hex[:8]}.tar"  # no-tmp: ok, Box path
        quoted_tar = shlex.quote(remote_tar)
        try:
            # --exclude: live sockets cannot be archived and must not fail the download.
            self._sh(
                f"mkdir -p {shlex.quote(hermes_dir)} && "
                f"tar cf {quoted_tar} --exclude='*.sock' -C / {shlex.quote(hermes_dir.lstrip('/'))}",
                "bulk download",
            )
            size = int(self._box.files.stat(remote_tar).size)
            cap = _sync_back_cap()
            if cap is not None and size > cap:
                # Hermes would discard an archive this large after downloading it. Skip the download
                # and hand it an empty archive, so nothing is applied and nothing is retried.
                logger.warning(
                    "Upstash Box: ~/.hermes in the Box is a %d-byte archive, over terminal.sync_back_max_bytes "
                    "(%d); not syncing it back",
                    size,
                    cap,
                )
                with tarfile.open(dest, "w"):
                    pass
                return
            with open(dest, "wb") as out:
                offset = 0
                while offset < size:
                    length = min(_READ_CHUNK, size - offset)
                    data = self._box.files.read(remote_tar, encoding="base64", offset=offset, length=length)
                    chunk = base64.b64decode(data or "")
                    if not chunk:
                        raise RuntimeError(f"Upstash Box bulk download: empty read at offset {offset} of {size}")
                    out.write(chunk)
                    offset += len(chunk)
        finally:
            with contextlib.suppress(Exception):
                self._box.exec.command(f"rm -f {quoted_tar}")

    # --- Command execution ---
    def _run_bash(self, cmd_string: str, *, login: bool = False, timeout: int = 120, stdin_data: str | None = None):
        box = self._current_box()
        argv = ["bash", "-c", _GATE_SCRIPT.format(flags="-l -c" if login else "-c"), "bash", cmd_string]
        # Guards ``state`` only. Never held across a network call, so a cancel can always take it.
        run_lock = threading.Lock()
        state: dict[str, Any] = {"cancelled": False, "handle": None}

        def cancel() -> None:
            # Called on Hermes's interrupt and timeout path: must return promptly, so the stop
            # itself runs on a helper thread (see ``_stop_session``).
            with run_lock:
                state["cancelled"] = True
                handle = state["handle"]
            if handle is None:
                # Still connecting: report now. The opener closes the session when it returns,
                # and the gate never opens, so the command never runs.
                proc.finish(130)
            else:
                _stop_session(handle)

        proc = _SessionProcess(cancel)

        def run() -> tuple[int, str]:
            payload = b""
            if stdin_data:
                try:
                    payload = stdin_data.encode("utf-8", "surrogateescape")
                except UnicodeError as exc:
                    # Nothing has started: refuse rather than run the command on partial input.
                    proc._hermes_stdin_errors.append(exc)
                    return 1, "[Upstash Box: command not started: its stdin could not be encoded]"
            with run_lock:
                if state["cancelled"]:
                    return 130, ""
            try:
                handle = self._open_session(box, argv, proc.feed)
            except _SessionStartError as exc:
                return 1, self._start_failure(box, exc)
            with run_lock:
                state["handle"] = handle  # from here on a cancel stops this session itself
            # Hold the start line until Hermes has registered the handle and checked for an
            # interrupt (see ``_SessionProcess.poll``), or a cancel arrives.
            if not proc.admitted.wait(max(int(timeout or 0), 1) + _WAIT_GRACE_S):
                _stop_session(handle)
                return 1, "[Upstash Box: command not started: nothing waited for it]"
            with run_lock:
                cancelled = state["cancelled"]
            if cancelled:
                _stop_session(handle)
                return 130, ""
            try:
                handle.write(_GATE_LINE)  # from here on the command runs
            except Exception as exc:
                with run_lock:
                    cancelled = state["cancelled"]
                if not cancelled:
                    _stop_session(handle)
                    return 1, f"[Upstash Box: could not start the command: {exc}]"
                # A cancel stopped the session mid-write; it reports below.
            if not state["cancelled"]:
                stdin_error = self._send_stdin(handle, payload)
                # A write broken by a cancel is the cancel, not a stdin failure.
                if stdin_error is not None and not state["cancelled"]:
                    proc._hermes_stdin_errors.append(stdin_error)
            try:
                code = handle.wait(timeout=max(int(timeout or 0), 1) + _WAIT_GRACE_S)
            except TimeoutError:
                _stop_session(handle)
                return 124, f"\n[Command timed out after {timeout}s]"
            finally:
                with contextlib.suppress(Exception):
                    handle.close()
            with run_lock:
                cancelled = state["cancelled"]
            if cancelled:
                return 130, ""
            if code is None or code < 0:
                return 1, "\n[Upstash Box session ended before the command exited]"
            return code, ""

        def worker() -> None:
            try:
                code, trailer = run()
            except Exception as exc:  # never leave the handle unfinished
                logger.debug("Upstash Box: command worker failed", exc_info=True)
                code, trailer = 1, f"[Upstash Box: {exc}]"
            proc.finish(code, trailer)

        threading.Thread(target=worker, name="upstash-box-command", daemon=True).start()
        return proc

    @staticmethod
    def _send_stdin(handle: Any, payload: bytes) -> Optional[BaseException]:
        """Write stdin and always send EOF. Returns the error to report, if any.

        A write that fails because the command already exited (it never read its input) is
        normal and not reported; a transport failure while the command still runs is."""

        def exited() -> bool:
            # The exit frame can trail the closed connection by a moment.
            try:
                return handle.wait(timeout=1) >= 0
            except Exception:
                return False

        error: Optional[BaseException] = None
        try:
            for start in range(0, len(payload), _STDIN_CHUNK):
                handle.write(payload[start : start + _STDIN_CHUNK])
        except Exception as exc:
            if not exited():
                error = exc
        finally:
            try:
                handle.end_stdin()
            except Exception as exc:
                if error is None and not exited():
                    error = exc
        return error

    def _open_session(self, box: Any, argv: list[str], on_output: Callable[[bytes], None]) -> Any:
        try:
            return box.exec.session(argv=argv, on_stdout=on_output, on_stderr=on_output)
        except Exception as exc:
            state = _box_state(box)
            if state != "paused":
                raise _SessionStartError(state, exc) from exc
        # A Box paused behind our back (idle pause, console) refuses the session; resume once.
        try:
            box.resume()
            return box.exec.session(argv=argv, on_stdout=on_output, on_stderr=on_output)
        except Exception as exc:
            raise _SessionStartError(_box_state(box), exc) from exc

    def _start_failure(self, box: Any, exc: _SessionStartError) -> str:
        box_id = getattr(box, "id", "?")
        if exc.state == "gone":
            self._forget_box(box)
            return (
                f"[Upstash Box: Box {box_id} no longer exists, so the command did not run. The next "
                "command runs in a new Box; files from the old one are gone.]"
            )
        if exc.state == "error":
            return (
                f"[Upstash Box: Box {box_id} is in the error state, so the command did not run. Delete "
                "it in the Upstash console (or with `box delete`); Hermes then creates a new one.]"
            )
        return f"[Upstash Box: could not start the command: {exc.cause}]"

    # --- Teardown ---
    def cleanup(self):
        lock = getattr(self, "_lock", None)
        if lock is None:  # __init__ failed before the lock existed
            return
        with lock:
            self._closed = True
            box = self._box
            if box is None:
                return
            if self._sync_manager is not None:
                try:
                    self._sync_back()
                except Exception as exc:
                    logger.warning("Upstash Box: sync_back failed: %s", exc)
            if not self._release(box):
                # Keep the Box (and its client) so a later cleanup() can try again.
                return
            with contextlib.suppress(Exception):
                box.close()
            with self._box_lock:
                if self._box is box:
                    self._box = None

    def _release(self, box: Any) -> bool:
        """Delete (non-persistent) or pause (persistent) this environment's own Box. True when
        done, or when the Box is already gone. Only ever acts on the exact Box object this
        environment attached, never by name, label or list."""
        box_id = getattr(box, "id", "?")
        if self._persistent and getattr(box, "keep_alive", False):
            logger.info("Upstash Box: keep-alive Box %s left running", box_id)
            return True
        action = "pause" if self._persistent else "delete"
        for attempt in range(1, _CLEANUP_ATTEMPTS + 1):
            try:
                if self._persistent:
                    box.pause()
                else:
                    box.delete()
            except Exception as exc:
                if getattr(exc, "status_code", None) == 404:
                    logger.info("Upstash Box: Box %s was already gone", box_id)
                    return True
                if attempt == _CLEANUP_ATTEMPTS or not _transient(exc):
                    logger.warning("Upstash Box: %s of Box %s failed: %s", action, box_id, exc)
                    return False
                time.sleep(_CLEANUP_BACKOFF_S * attempt)
                continue
            if self._persistent:
                logger.info("Upstash Box: paused Box %s (files preserved)", box_id)
            else:
                logger.info("Upstash Box: deleted Box %s", box_id)
            return True
        return False


__all__ = ["UpstashBoxEnvironment", "box_labels", "box_name"]
