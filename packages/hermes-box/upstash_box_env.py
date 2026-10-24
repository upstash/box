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
import threading
import uuid
from pathlib import Path
from typing import Any, Optional

from tools.environments.base import BaseEnvironment
from tools.environments.base_output import _ThreadedProcessHandle
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
DEFAULT_HOME = "/workspace/home"
BASE_LABEL = "hermes"

# Box API limits: at most 5 labels per Box, each at most 20 characters.
_MAX_LABELS = 5
_MAX_LABEL_LEN = 20
_MAX_NAME_LEN = 63
# files.read caps a bounded range at 8 MiB; stay well under it.
_READ_CHUNK = 4 * 1024 * 1024
# Stdin is sent as session frames; keep each frame small.
_STDIN_CHUNK = 256 * 1024
# Extra seconds the session wait allows past the command timeout. The base class enforces
# the timeout itself (it kills the handle); this only bounds a wedged connection.
_WAIT_GRACE_S = 15


def _load_sdk():
    """``(Box, BoxError)`` from the ``upstash-box`` SDK. Tests replace this with a fake."""
    from upstash_box import Box, BoxError

    return Box, BoxError


def _slug(value: str) -> str:
    return re.sub(r"-{2,}", "-", re.sub(r"[^a-z0-9-]", "-", value.lower())).strip("-")


def box_name(prefix: str, task_id: str, *, unique: bool = False) -> str:
    """Box name for a task: ``<prefix>-<task slug>`` in ``[a-z0-9-]``, at most 63 characters.

    A task id that had to be changed or shortened gets a short hash of the original, so two
    task ids that slug the same never share a Box. ``unique`` adds a random suffix (one Box per
    session in non-persistent mode)."""
    prefix = _slug(prefix) or BASE_LABEL
    slug = _slug(task_id) or "default"
    suffix = ""
    if slug != task_id or len(slug) > 32:
        suffix = "-" + hashlib.sha256(task_id.encode("utf-8")).hexdigest()[:8]
        slug = slug[:32].rstrip("-")
    if unique:
        suffix += "-" + uuid.uuid4().hex[:8]
    room = _MAX_NAME_LEN - len(prefix) - 1 - len(suffix)
    return f"{prefix}-{slug[: max(room, 1)].rstrip('-')}{suffix}"


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


class UpstashBoxEnvironment(BaseEnvironment):
    """Hermes commands in an Upstash Box.

    Commands run through ``_ThreadedProcessHandle`` wrapping a blocking exec session; the
    handle's ``cancel_fn`` kills the remote process tree, which is how interrupts and timeouts
    stop a command. Merged stdout and stderr are returned in arrival order.
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
        super().__init__(cwd=cwd, timeout=timeout)
        self._requested_cwd = cwd
        self._persistent = bool(persistent)
        self._task_id = task_id
        self._size = size or "small"
        self._runtime = runtime or None
        self._keep_alive = bool(keep_alive)
        self._labels = box_labels(labels)
        self._name_prefix = name_prefix or BASE_LABEL
        # Credentials stay in this object only; they are never logged or sent into the Box.
        self._conn: dict[str, str] = {"api_key": api_key} if api_key else {}
        if base_url:
            self._conn["base_url"] = base_url
        self._lock = threading.Lock()
        self._box: Any = None
        self._created = False
        self._remote_home = DEFAULT_HOME
        self._sync_manager: Optional[FileSyncManager] = None

        self._attach()
        self._sync_manager.sync(force=True)
        self.init_session()

    # --- Box lifecycle ---
    @property
    def box_id(self) -> Optional[str]:
        return getattr(self._box, "id", None)

    @property
    def remote_home(self) -> str:
        return self._remote_home

    def _attach(self) -> None:
        """Resume this task's Box (persistent) or create one, then resolve home and file sync."""
        Box, BoxError = _load_sdk()
        box = None
        if self._persistent:
            name = box_name(self._name_prefix, self._task_id)
            try:
                box = Box.get_by_name(name, **self._conn)
            except BoxError as exc:
                if getattr(exc, "status_code", None) != 404:
                    raise RuntimeError(f"Upstash Box: could not look up Box {name!r}: {exc}") from exc
                box = None
            if box is not None:
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
                    box = None
                else:
                    if status == "paused":
                        box.resume()
                    logger.info("Upstash Box: resumed Box %s (%s) for task %s", name, box.id, self._task_id)
        else:
            name = box_name(self._name_prefix, self._task_id, unique=True)
        if box is None:
            create: dict[str, Any] = {"name": name, "labels": list(self._labels), "size": self._size}
            if self._runtime:
                create["runtime"] = self._runtime
            if self._keep_alive:
                create["keep_alive"] = True
            box = Box.create(**create, **self._conn)
            self._created = True
            logger.info("Upstash Box: created Box %s (%s) for task %s", name, box.id, self._task_id)
        self._box = box
        self._remote_home = self._detect_home()
        if self._requested_cwd in {"~", "", DEFAULT_HOME}:
            self.cwd = self._remote_home
        elif self._requested_cwd.startswith("~/"):
            self.cwd = f"{self._remote_home.rstrip('/')}/{self._requested_cwd[2:]}"
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

    def _ensure_box(self) -> Any:
        if self._box is None:
            # Cleaned up and used again: attach anew. A non-persistent Box was deleted, so the
            # workspace is fresh, and the model is told so.
            self._attach()
            if not self._persistent:
                self._mark_recreated()
            self._sync_manager.sync(force=True)
        return self._box

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
        self._box.files.upload([{"path": host, "destination": remote} for host, remote in files])

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
        box = self._ensure_box()
        argv = ["bash", "-l", "-c", cmd_string] if login else ["bash", "-c", cmd_string]
        run_lock = threading.Lock()
        state: dict[str, Any] = {"cancelled": False, "handle": None}
        chunks: list[bytes] = []

        def collect(data: bytes) -> None:
            chunks.append(data if isinstance(data, bytes) else str(data).encode("utf-8", "replace"))

        def output() -> str:
            return b"".join(chunks).decode("utf-8", "replace")

        def stop(handle: Any) -> None:
            with contextlib.suppress(Exception):
                handle.kill("KILL")
            with contextlib.suppress(Exception):
                handle.close()  # closing the session also kills the process

        def cancel() -> None:
            with run_lock:
                state["cancelled"] = True
                handle = state["handle"]
            if handle is not None:
                stop(handle)

        def exec_fn() -> tuple[str, int]:
            with run_lock:
                if state["cancelled"]:
                    return ("", 130)
            try:
                handle = self._open_session(box, argv, collect)
            except Exception as exc:
                return (f"[Upstash Box: could not start the command: {exc}]", 1)
            with run_lock:
                state["handle"] = handle
                cancelled = state["cancelled"]
            if cancelled:
                stop(handle)
                return (output(), 130)
            try:
                if stdin_data:
                    payload = stdin_data.encode("utf-8", "surrogateescape")
                    for start in range(0, len(payload), _STDIN_CHUNK):
                        handle.write(payload[start : start + _STDIN_CHUNK])
                # Always close stdin: a command reading it must see EOF, not hang.
                handle.end_stdin()
            except Exception as exc:
                logger.debug("Upstash Box: stdin write failed: %s", exc)
            try:
                code = handle.wait(timeout=max(int(timeout or 0), 1) + _WAIT_GRACE_S)
            except TimeoutError:
                stop(handle)
                return (output() + f"\n[Command timed out after {timeout}s]", 124)
            finally:
                with contextlib.suppress(Exception):
                    handle.close()
            with run_lock:
                cancelled = state["cancelled"]
            if cancelled:
                return (output(), 130)
            if code is None or code < 0:
                return (output() + "\n[Upstash Box session ended before the command exited]", 1)
            return (output(), code)

        return _ThreadedProcessHandle(exec_fn, cancel_fn=cancel)

    def _open_session(self, box: Any, argv: list[str], collect) -> Any:
        try:
            return box.exec.session(argv=argv, on_stdout=collect, on_stderr=collect)
        except Exception:
            # A Box paused behind our back (idle pause, console) refuses the session; resume once.
            if _status_of(box) != "paused":
                raise
            box.resume()
            return box.exec.session(argv=argv, on_stdout=collect, on_stderr=collect)

    # --- Teardown ---
    def cleanup(self):
        lock = getattr(self, "_lock", None)
        if lock is None:  # __init__ failed before the lock existed
            return
        with lock:
            box = self._box
            if box is None:
                return
            if self._sync_manager is not None:
                try:
                    self._sync_manager.sync_back()
                except Exception as exc:
                    logger.warning("Upstash Box: sync_back failed: %s", exc)
            try:
                if not self._persistent:
                    box.delete()
                    logger.info("Upstash Box: deleted Box %s", box.id)
                elif getattr(box, "keep_alive", False):
                    logger.info("Upstash Box: keep-alive Box %s left running", box.id)
                else:
                    box.pause()
                    logger.info("Upstash Box: paused Box %s (files preserved)", box.id)
            except Exception as exc:
                logger.warning("Upstash Box: cleanup of Box %s failed: %s", getattr(box, "id", "?"), exc)
            finally:
                with contextlib.suppress(Exception):
                    box.close()
                self._box = None


__all__ = ["UpstashBoxEnvironment", "box_labels", "box_name"]
