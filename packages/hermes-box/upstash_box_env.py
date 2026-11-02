"""Upstash Box execution environment.

Runs Hermes commands in an Upstash Box through the ``upstash-box`` Python SDK. Every command
runs in a live exec session (``box.exec.session``) so stdin can be streamed in and an interrupt
or timeout can kill the remote process tree. Persistent mode resumes a Box by name and pauses
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
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Optional

from tools.environments.base import BaseEnvironment

try:
    from tools.environments.base import EnvironmentConnectionError
except ImportError:  # older Hermes: same shape, reported as an ordinary tool failure

    class EnvironmentConnectionError(RuntimeError):  # type: ignore[no-redef]
        def __init__(self, reason: str, *, retry_hint: str = ""):
            super().__init__(reason)
            self.reason, self.retry_hint = reason, retry_hint


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
# The SDK reads every file of an upload into memory, so file sync uploads in batches of at most
# this many bytes (a larger single file goes alone).
_UPLOAD_BATCH_BYTES = 32 * 1024 * 1024
# Stdin is sent as session frames; keep each frame small.
_STDIN_CHUNK = 256 * 1024
# Extra seconds the session wait allows past the command timeout. The base class enforces
# the timeout itself (it kills the handle); this only bounds a wedged connection.
_WAIT_GRACE_S = 15
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


def _stop_session(handle: Any) -> None:
    """Kill the remote process tree and close the session, on a helper thread.

    The caller is Hermes's interrupt or timeout path, which must not wait on the network: ``kill``
    queues behind a stdin write that is still being sent."""

    def stop() -> None:
        with contextlib.suppress(Exception):
            handle.kill("KILL")
        with contextlib.suppress(Exception):
            handle.close()  # closing the session also kills the process

    threading.Thread(target=stop, name="upstash-box-stop", daemon=True).start()


class _SessionStartError(Exception):
    def __init__(self, state: str, cause: BaseException):
        super().__init__(str(cause))
        self.state = state
        self.cause = cause


class _SessionProcess:
    """``ProcessHandle`` for one exec session: output goes into a pipe that Hermes's drain reads.

    ``feed`` runs on the SDK's WebSocket reader thread and writes straight into the pipe. When the
    pipe is full the write waits, which holds back the WebSocket instead of dropping output; once
    Hermes has closed its end, output is discarded. ``finish`` closes the pipe, so ``poll()``
    reports the exit only after every byte has been written."""

    def __init__(self) -> None:
        read_fd, self._write_fd = os.pipe()
        self._stdout = os.fdopen(read_fd, "r", encoding="utf-8", errors="replace")
        self.cancel: Callable[[], None] = lambda: None
        self._lock = threading.Lock()
        self._open = True
        self._broken = False
        self._returncode: Optional[int] = None
        self._done = threading.Event()
        # Read by BaseEnvironment._wait_for_process and reported as ``stdin_error``.
        self._hermes_stdin_errors: list[BaseException] = []

    def _write(self, data: bytes) -> None:  # caller holds ``_lock``
        view = memoryview(data)
        while view and not self._broken:
            try:
                view = view[os.write(self._write_fd, view) :]
            except OSError:  # Hermes closed its end: nothing left to deliver to
                self._broken = True

    def feed(self, data: Any) -> None:
        if not data:
            return
        if not isinstance(data, bytes):
            data = str(data).encode("utf-8", "replace")
        with self._lock:
            if self._open:
                self._write(data)

    def finish(self, code: int, trailer: str = "") -> None:
        """Record the result. The first call wins; output fed afterwards is ignored."""
        with self._lock:
            if not self._open:
                return
            self._open = False
            if trailer:
                self._write(trailer.encode("utf-8", "replace"))
            os.close(self._write_fd)
        self._returncode = code
        self._done.set()

    @property
    def stdout(self):
        return self._stdout

    @property
    def returncode(self) -> Optional[int]:
        return self._returncode

    def poll(self) -> Optional[int]:
        return self._returncode if self._done.is_set() else None

    def kill(self) -> None:
        with contextlib.suppress(Exception):
            self.cancel()

    def wait(self, timeout: Optional[float] = None) -> Optional[int]:
        self._done.wait(timeout)
        return self._returncode


class UpstashBoxEnvironment(BaseEnvironment):
    """Hermes commands in an Upstash Box.

    Each command is one exec session behind a ``_SessionProcess``; its ``kill()`` kills the
    session's process tree, and that is how interrupts and timeouts stop a command. Merged
    stdout and stderr stream back in arrival order.
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
        self._keep_alive = bool(keep_alive) and self._persistent
        if keep_alive and not self._persistent:
            # A keep-alive Box is billed monthly; one per session, deleted at its end, is never wanted.
            logger.warning("Upstash Box: upstash_box_keep_alive only applies with container_persistent: true")
        self._labels = box_labels(labels)
        self._name_prefix = name_prefix or BASE_LABEL
        # Credentials stay in this object only; they are never logged or sent into the Box.
        self._conn: dict[str, str] = {"api_key": api_key, "base_url": base_url or DEFAULT_BASE_URL}
        self._lock = threading.Lock()
        self._box: Any = None
        self._created = False
        # Set by cleanup(). Hermes unregisters an environment before cleaning it up, so a later call
        # comes from a stale reference; it is refused rather than given a Box nothing would release.
        self._closed = False
        self._remote_home = DEFAULT_HOME
        self._sync_manager: Optional[FileSyncManager] = None
        self._set_up()

    # --- Box lifecycle ---
    @property
    def box_id(self) -> Optional[str]:
        return getattr(self._box, "id", None)

    @property
    def remote_home(self) -> str:
        return self._remote_home

    def _set_up(self) -> None:
        """Attach a Box, sync files and take the shell snapshot."""
        self._attach()
        self._sync_manager.sync(force=True)
        self._snapshot_ready = False
        self.init_session()

    def _find(self, Box: Any, BoxError: Any, name: str) -> Any:
        """This task's existing Box by name, resumed if paused, or None when there is none."""
        try:
            box = Box.get_by_name(name, **self._conn)
        except BoxError as exc:
            if getattr(exc, "status_code", None) != 404:
                raise RuntimeError(f"Upstash Box: could not look up Box {name!r}: {exc}") from exc
            return None
        status = _box_state(box)
        if status in {"error", "gone"}:
            with contextlib.suppress(Exception):
                box.close()
            if status == "gone":
                return None
            raise RuntimeError(
                f"Upstash Box: Box {name!r} is in the error state. Delete it in the Upstash "
                "console (or with `box delete`) and Hermes will create a new one."
            )
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
            box = Box.create(**create, **self._conn)
        except BoxError as exc:
            if "box limit" in str(exc).lower():
                raise RuntimeError(
                    f"Upstash Box: your account has reached its Box limit ({exc}). Paused Boxes count "
                    "toward it, and persistent mode keeps one Box per task. Delete Boxes you no longer "
                    "need (`box list --label hermes`, then `box delete <id>`) or upgrade your plan."
                ) from exc
            # Another Hermes process created this task's Box between our lookup and create.
            box = self._find(Box, BoxError, name) if self._persistent and _is_name_conflict(exc) else None
            if box is None:
                raise
            return box
        self._created = True
        logger.info("Upstash Box: created Box %s (%s) for task %s", name, box.id, self._task_id)
        return box

    def _attach(self) -> None:
        """Resume this task's Box (persistent) or create one, then resolve home and file sync."""
        _disable_sdk_telemetry()
        Box, BoxError = _load_sdk()
        self._created = False
        if self._persistent:
            name = box_name(self._name_prefix, self._task_id)
            box = self._find(Box, BoxError, name) or self._create(Box, BoxError, name)
        else:
            box = self._create(Box, BoxError, box_name(self._name_prefix, self._task_id, unique=True))
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
            get_files_fn=lambda: iter_sync_files(container_base),
            upload_fn=self._upload,
            delete_fn=self._delete,
            bulk_upload_fn=self._bulk_upload,
            bulk_download_fn=self._bulk_download,
        )

    def _detect_home(self) -> str:
        fallback = getattr(self._box, "cwd", None) or DEFAULT_HOME
        try:
            run = self._box.exec.command('printf %s "$HOME"')
            home = (run.stdout or "").strip()
        except Exception as exc:
            logger.debug("Upstash Box: home detection failed: %s", exc)
            return fallback
        return home if home.startswith("/") else fallback

    def _forget_box(self, box: Any) -> None:
        """Drop a Box the API reports as gone, so the next command attaches a new one. Nothing is
        deleted: the Box no longer exists."""
        if self._box is not box:
            return
        self._box = None
        with contextlib.suppress(Exception):
            box.close()
        logger.warning("Upstash Box: Box %s no longer exists; the next command gets a new one", getattr(box, "id", "?"))

    def _before_execute(self) -> None:
        with self._lock:
            if self._closed:
                raise EnvironmentConnectionError(
                    "Upstash Box: this environment was cleaned up and has no Box any more.",
                    retry_hint="Retry the command; Hermes starts a new Upstash Box environment for it.",
                )
            if self._box is None:
                # An earlier command found the Box deleted: attach anew. A new Box is an empty
                # workspace, and the model is told so. The shell snapshot lived in the old Box.
                self._set_up()
                if self._created:
                    self._mark_recreated()
            if self._box is None:  # it vanished again while being set up
                raise EnvironmentConnectionError("Upstash Box: the Box disappeared while it was being set up.")
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
            size = os.path.getsize(host) if os.path.exists(host) else 0
            if batch and batch_bytes + size > _UPLOAD_BATCH_BYTES:
                self._box.files.upload(batch)
                batch, batch_bytes = [], 0
            batch.append({"path": host, "destination": remote})
            batch_bytes += size
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
        proc = _SessionProcess()
        # Only ``_before_execute`` attaches a Box, under ``_lock``. A command started while there is
        # none (the Box vanished during setup) fails, and the next ``execute`` sets up a new one.
        box = self._box
        if box is None or self._closed:
            proc.finish(1, "[Upstash Box: no Box is attached; retry the command]")
            return proc
        argv = ["bash", "-lc" if login else "-c", cmd_string]
        lock = threading.Lock()
        state: dict[str, Any] = {"cancelled": False, "handle": None}

        def cancel() -> None:
            with lock:
                state["cancelled"] = True
                handle = state["handle"]
            if handle is None:
                proc.finish(130)  # still connecting: the opener stops the session when it returns
            else:
                _stop_session(handle)

        proc.cancel = cancel

        def run() -> tuple[int, str]:
            try:
                payload = (stdin_data or "").encode("utf-8", "surrogateescape")
            except UnicodeError as exc:
                # Nothing has started: refuse rather than run the command on partial input.
                proc._hermes_stdin_errors.append(exc)
                return 1, "[Upstash Box: command not started: its stdin could not be encoded]"
            if state["cancelled"]:
                return 130, ""
            try:
                handle = self._open_session(box, argv, proc.feed)
            except _SessionStartError as exc:
                return 1, self._start_failure(box, exc)
            with lock:
                state["handle"] = handle
                cancelled = state["cancelled"]
            if cancelled:
                _stop_session(handle)
                return 130, ""
            stdin_error = self._send_stdin(handle, payload)
            try:
                code = handle.wait(timeout=max(int(timeout or 0), 1) + _WAIT_GRACE_S)
            except TimeoutError:
                _stop_session(handle)
                return 124, f"\n[Command timed out after {timeout}s]"
            finally:
                with contextlib.suppress(Exception):
                    handle.close()
            if state["cancelled"]:
                return 130, ""
            if stdin_error is not None:
                proc._hermes_stdin_errors.append(stdin_error)
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
        """Write stdin, then always send EOF. Returns the error to report, if any: a write that
        fails because the command already exited (it never read its input) is normal."""
        try:
            for start in range(0, len(payload), _STDIN_CHUNK):
                handle.write(payload[start : start + _STDIN_CHUNK])
            handle.end_stdin()
            return None
        except Exception as exc:
            # Ask before sending EOF, which would let a command still reading its input exit.
            try:
                exited = handle.wait(timeout=1) >= 0  # the exit frame can trail a closed connection
            except Exception:
                exited = False
            with contextlib.suppress(Exception):
                handle.end_stdin()
            return None if exited else exc

    def _open_session(self, box: Any, argv: list[str], on_output: Callable[[bytes], None]) -> Any:
        try:
            return box.exec.session(argv=argv, on_stdout=on_output, on_stderr=on_output)
        except Exception as exc:
            state = _box_state(box)
            if state != "paused" or self._closed:  # never resume a Box cleanup just paused
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
                    self._sync_manager.sync_back()
                except Exception as exc:
                    logger.warning("Upstash Box: sync_back failed: %s", exc)
            if not self._release(box):
                # Keep the Box (and its client) so a later cleanup() can try again.
                return
            with contextlib.suppress(Exception):
                box.close()
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
            logger.info("Upstash Box: %s Box %s", "paused" if self._persistent else "deleted", box_id)
            return True
        return False


__all__ = ["UpstashBoxEnvironment", "box_labels", "box_name"]
