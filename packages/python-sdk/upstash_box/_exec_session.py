"""Live exec sessions over WebSocket.

Both flavors are hand-written. The async handle pumps frames with an asyncio
task and the sync handle with a reader thread, an asymmetry that
scripts/generate_sync.py cannot produce by token substitution. Everything that
defines the wire protocol (frame construction, validation, decoding) is shared
below so the two handles cannot drift apart.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import inspect
import json
import re
import threading
import time
from typing import Any, Callable, Dict, List, Optional, Union

from .errors import BoxError

StdoutCallback = Callable[[bytes], Any]

_SIGNALS = frozenset({"TERM", "KILL", "INT", "HUP", "TSTP", "QUIT", "USR1", "USR2"})


def session_url(base_url: str, box_id: str) -> str:
    return re.sub(r"^http", "ws", base_url) + f"/v2/box/{box_id}/exec-session"


def build_start_frame(
    *,
    cmd: Optional[str],
    argv: Optional[List[str]],
    tty: bool,
    cwd: str,
    rows: Optional[int],
    cols: Optional[int],
    env: Optional[List[str]],
) -> Dict[str, Any]:
    """Assemble the opening frame. ``argv`` takes precedence over ``cmd``."""
    has_argv = bool(argv)
    if not has_argv and not cmd:
        raise BoxError("exec.session requires cmd or argv")
    start: Dict[str, Any] = {"type": "start"}
    if has_argv:
        start["argv"] = list(argv or [])
    else:
        start["cmd"] = cmd
    if tty:
        start["tty"] = True
    start["cwd"] = cwd
    if rows:
        start["rows"] = rows
    if cols:
        start["cols"] = cols
    if env:
        start["env"] = list(env)
    return start


def normalize_signal(signal: Optional[str]) -> str:
    sig = ("TERM" if signal is None else signal).strip().upper()
    if sig.startswith("SIG"):
        sig = sig[3:]
    if sig not in _SIGNALS:
        raise BoxError(f"unsupported signal: {signal}")
    return sig


def stdin_frame(data: Union[str, bytes]) -> Dict[str, Any]:
    payload = data.encode("utf-8") if isinstance(data, str) else bytes(data)
    return {"type": "stdin", "data": base64.b64encode(payload).decode("ascii")}


def terminate_frame(grace_ms: Optional[int]) -> Dict[str, Any]:
    frame: Dict[str, Any] = {"type": "terminate"}
    if grace_ms and grace_ms > 0:
        frame["graceMs"] = grace_ms
    return frame


def parse_frame(raw: Union[str, bytes]) -> Optional[Dict[str, Any]]:
    """Decode one server frame, ignoring anything unparseable."""
    try:
        frame = json.loads(raw if isinstance(raw, str) else raw.decode("utf-8"))
    except Exception:
        return None
    return frame if isinstance(frame, dict) else None


def frame_payload(frame: Dict[str, Any]) -> bytes:
    data = frame.get("data")
    if not isinstance(data, str):
        return b""
    try:
        return base64.b64decode(data)
    except Exception:
        return b""


def exit_code_of(frame: Dict[str, Any]) -> int:
    code = frame.get("code")
    return code if isinstance(code, int) else -1


def _handshake_error(frame: Dict[str, Any]) -> BoxError:
    return BoxError(f"exec-session error: {frame.get('message')}")


def _started_fields(frame: Dict[str, Any]) -> "tuple[int, str]":
    """Read the started frame. A session whose process cannot be signaled is
    useless, so a missing or non-positive pid fails the handshake rather than
    producing a handle whose ``kill``/``terminate`` would go nowhere."""
    pid = frame.get("pid")
    if not isinstance(pid, int) or isinstance(pid, bool) or pid <= 0:
        raise BoxError("exec-session started without a usable pid")
    exec_id = frame.get("execId")
    return (pid, exec_id if isinstance(exec_id, str) else "")


# ==================== Async ====================


class AsyncExecSessionHandle:
    """A live command session.

    ``session()`` returns this once the process has started. Output flows to the
    ``on_stdout``/``on_stderr`` callbacks passed to ``session()``.

    The session owns the process: losing the connection kills it. ``close()``, a
    dropped network link, or exiting the program all terminate the command
    rather than leaving it running in the box, and sessions cannot be
    reattached. Use ``wait()`` to run something to completion.

    Callbacks run on the task pumping the socket, so a slow callback delays
    later output. An ``async`` callback is awaited, so it can do I/O without
    blocking the loop.
    """

    pid: int
    """In-box (container-namespace) PID, always non-zero: a session whose
    process cannot be signaled fails the handshake instead."""

    exec_id: str
    """Server-side exec id."""

    def __init__(
        self,
        conn: Any,
        pid: int,
        exec_id: str,
        on_stdout: Optional[StdoutCallback],
        on_stderr: Optional[StdoutCallback],
    ) -> None:
        self.pid = pid
        self.exec_id = exec_id
        self._conn = conn
        self._on_stdout = on_stdout
        self._on_stderr = on_stderr
        self._exit: asyncio.Future[int] = asyncio.get_running_loop().create_future()
        self._reader = asyncio.ensure_future(self._pump())

    async def _dispatch(self, cb: Optional[StdoutCallback], frame: Dict[str, Any]) -> None:
        if cb is None:
            return
        result = cb(frame_payload(frame))
        if inspect.isawaitable(result):
            await result

    async def _pump(self) -> None:
        try:
            async for raw in self._conn:
                frame = parse_frame(raw)
                if frame is None:
                    continue
                kind = frame.get("type")
                if kind == "stdout":
                    await self._dispatch(self._on_stdout, frame)
                elif kind == "stderr":
                    await self._dispatch(self._on_stderr, frame)
                elif kind == "exit":
                    self._settle(exit_code_of(frame))
                    break
                elif kind == "error":
                    self._settle(-1)
                    break
        except Exception:
            pass
        finally:
            self._settle(-1)
            with contextlib.suppress(Exception):
                await self._conn.close()

    def _settle(self, code: int) -> None:
        if not self._exit.done():
            self._exit.set_result(code)

    async def _send(self, frame: Dict[str, Any]) -> None:
        try:
            await self._conn.send(json.dumps(frame))
        except Exception as exc:
            raise BoxError(f"exec-session send failed: {exc}") from exc

    async def write(self, data: Union[str, bytes]) -> None:
        """Write bytes to the process stdin."""
        if self._exit.done():
            return
        await self._send(stdin_frame(data))

    async def end_stdin(self) -> None:
        """Close stdin (send EOF). A command that reads until EOF (``cat``,
        ``sort``) then exits on its own; output keeps flowing until it does."""
        if self._exit.done():
            return
        await self._send({"type": "stdin_close"})

    async def resize(self, rows: int, cols: int) -> None:
        """Resize the PTY (TTY sessions)."""
        if self._exit.done():
            return
        await self._send({"type": "resize", "rows": rows, "cols": cols})

    async def kill(self, signal: Optional[str] = None) -> None:
        """Send a signal to the process tree. Defaults to ``TERM``."""
        if self._exit.done():
            return
        await self._send({"type": "signal", "signal": normalize_signal(signal)})

    async def terminate(self, grace_ms: Optional[int] = None) -> None:
        """Graceful stop driven server-side: SIGTERM now, then SIGKILL after
        ``grace_ms`` (default is the server's grace) if still running.

        Only the first call starts the sequence; later ones are ignored, so the
        grace cannot be changed once it is running. Use ``kill("KILL")`` to stop
        the process immediately instead."""
        if self._exit.done():
            return
        await self._send(terminate_frame(grace_ms))

    async def wait(self) -> int:
        """Wait for the process to finish and return its exit code (``-1`` if it
        was still running at a forced teardown)."""
        return await asyncio.shield(self._exit)

    async def close(self) -> None:
        """Close the connection, terminating the process if still running."""
        with contextlib.suppress(Exception):
            await self._conn.close()
        if self._reader is not asyncio.current_task():
            with contextlib.suppress(Exception):
                await self._reader
        self._settle(-1)

    async def __aenter__(self) -> "AsyncExecSessionHandle":
        return self

    async def __aexit__(self, *_exc: Any) -> None:
        await self.close()


async def open_async_exec_session(
    *,
    url: str,
    headers: Dict[str, str],
    timeout_s: Optional[float],
    start: Dict[str, Any],
    on_stdout: Optional[StdoutCallback] = None,
    on_stderr: Optional[StdoutCallback] = None,
) -> AsyncExecSessionHandle:
    try:
        from websockets.asyncio.client import connect
    except ImportError as exc:  # pragma: no cover
        raise BoxError("exec.session requires the 'websockets' package") from exc

    try:
        conn = await connect(url, additional_headers=headers, open_timeout=timeout_s, max_size=None)
    except Exception as exc:
        raise BoxError(f"exec-session connection failed: {exc}") from exc

    handshake_failed = True
    try:
        await conn.send(json.dumps(start))
        # One deadline for the whole handshake. Frames that are not "started"
        # are skipped below, so a per-receive timeout would restart on every
        # ignored frame and a chatty peer could keep session() pending forever.
        loop = asyncio.get_running_loop()
        deadline = None if timeout_s is None else loop.time() + timeout_s
        while True:
            try:
                remaining = None if deadline is None else max(0.0, deadline - loop.time())
                raw = await asyncio.wait_for(conn.recv(), remaining)
            except asyncio.TimeoutError as exc:
                raise BoxError("exec.session handshake timed out") from exc
            except Exception as exc:
                raise BoxError("exec-session closed before start") from exc
            frame = parse_frame(raw)
            if frame is None:
                continue
            kind = frame.get("type")
            if kind == "started":
                pid, exec_id = _started_fields(frame)
                handle = AsyncExecSessionHandle(conn, pid, exec_id, on_stdout, on_stderr)
                handshake_failed = False
                return handle
            if kind == "error":
                raise _handshake_error(frame)
            if kind == "exit":
                raise BoxError("exec-session exited before start")
    finally:
        if handshake_failed:
            with contextlib.suppress(Exception):
                await conn.close()


# ==================== Sync ====================


class ExecSessionHandle:
    """A live command session.

    ``session()`` returns this once the process has started. Output flows to the
    ``on_stdout``/``on_stderr`` callbacks passed to ``session()``, invoked on a
    background reader thread.

    The session owns the process: losing the connection kills it. ``close()``, a
    dropped network link, or exiting the program all terminate the command
    rather than leaving it running in the box, and sessions cannot be
    reattached. Use ``wait()`` to run something to completion.

    Callbacks run on the background reader thread, which is also what delivers
    the exit frame. Keep them short: blocking there stalls the stream, and
    calling ``wait()`` from inside one deadlocks, because the exit it waits for
    can only arrive on the thread it is blocking. Hand work to your own queue
    instead.
    """

    pid: int
    """In-box (container-namespace) PID, always non-zero: a session whose
    process cannot be signaled fails the handshake instead."""

    exec_id: str
    """Server-side exec id."""

    def __init__(
        self,
        conn: Any,
        pid: int,
        exec_id: str,
        on_stdout: Optional[StdoutCallback],
        on_stderr: Optional[StdoutCallback],
    ) -> None:
        self.pid = pid
        self.exec_id = exec_id
        self._conn = conn
        self._on_stdout = on_stdout
        self._on_stderr = on_stderr
        self._exit_code = -1
        self._exited = threading.Event()
        self._send_lock = threading.Lock()
        self._reader = threading.Thread(target=self._pump, daemon=True)
        self._reader.start()

    def _dispatch(self, cb: Optional[StdoutCallback], frame: Dict[str, Any]) -> None:
        if cb is not None:
            cb(frame_payload(frame))

    def _pump(self) -> None:
        try:
            for raw in self._conn:
                frame = parse_frame(raw)
                if frame is None:
                    continue
                kind = frame.get("type")
                if kind == "stdout":
                    self._dispatch(self._on_stdout, frame)
                elif kind == "stderr":
                    self._dispatch(self._on_stderr, frame)
                elif kind == "exit":
                    self._settle(exit_code_of(frame))
                    break
                elif kind == "error":
                    self._settle(-1)
                    break
        except Exception:
            pass
        finally:
            self._settle(-1)
            with contextlib.suppress(Exception):
                self._conn.close()

    def _settle(self, code: int) -> None:
        if not self._exited.is_set():
            self._exit_code = code
            self._exited.set()

    def _send(self, frame: Dict[str, Any]) -> None:
        try:
            with self._send_lock:
                self._conn.send(json.dumps(frame))
        except Exception as exc:
            raise BoxError(f"exec-session send failed: {exc}") from exc

    def write(self, data: Union[str, bytes]) -> None:
        """Write bytes to the process stdin."""
        if self._exited.is_set():
            return
        self._send(stdin_frame(data))

    def end_stdin(self) -> None:
        """Close stdin (send EOF). A command that reads until EOF (``cat``,
        ``sort``) then exits on its own; output keeps flowing until it does."""
        if self._exited.is_set():
            return
        self._send({"type": "stdin_close"})

    def resize(self, rows: int, cols: int) -> None:
        """Resize the PTY (TTY sessions)."""
        if self._exited.is_set():
            return
        self._send({"type": "resize", "rows": rows, "cols": cols})

    def kill(self, signal: Optional[str] = None) -> None:
        """Send a signal to the process tree. Defaults to ``TERM``."""
        if self._exited.is_set():
            return
        self._send({"type": "signal", "signal": normalize_signal(signal)})

    def terminate(self, grace_ms: Optional[int] = None) -> None:
        """Graceful stop driven server-side: SIGTERM now, then SIGKILL after
        ``grace_ms`` (default is the server's grace) if still running.

        Only the first call starts the sequence; later ones are ignored, so the
        grace cannot be changed once it is running. Use ``kill("KILL")`` to stop
        the process immediately instead."""
        if self._exited.is_set():
            return
        self._send(terminate_frame(grace_ms))

    def wait(self, timeout: Optional[float] = None) -> int:
        """Wait for the process to finish and return its exit code (``-1`` if it
        was still running at a forced teardown). Raises ``TimeoutError`` if
        ``timeout`` elapses first."""
        if not self._exited.wait(timeout):
            raise TimeoutError("exec.session wait timed out")
        return self._exit_code

    def close(self) -> None:
        """Close the connection, terminating the process if still running."""
        with contextlib.suppress(Exception):
            self._conn.close()
        if self._reader is not threading.current_thread():
            self._reader.join(timeout=5)
        self._settle(-1)

    def __enter__(self) -> "ExecSessionHandle":
        return self

    def __exit__(self, *_exc: Any) -> None:
        self.close()


def open_exec_session(
    *,
    url: str,
    headers: Dict[str, str],
    timeout_s: Optional[float],
    start: Dict[str, Any],
    on_stdout: Optional[StdoutCallback] = None,
    on_stderr: Optional[StdoutCallback] = None,
) -> ExecSessionHandle:
    try:
        from websockets.sync.client import connect
    except ImportError as exc:  # pragma: no cover
        raise BoxError("exec.session requires the 'websockets' package") from exc

    try:
        conn = connect(url, additional_headers=headers, open_timeout=timeout_s, max_size=None)
    except Exception as exc:
        raise BoxError(f"exec-session connection failed: {exc}") from exc

    handshake_failed = True
    try:
        conn.send(json.dumps(start))
        # One deadline for the whole handshake; see the async note above.
        deadline = None if timeout_s is None else time.monotonic() + timeout_s
        while True:
            try:
                remaining = None if deadline is None else max(0.0, deadline - time.monotonic())
                raw = conn.recv(timeout=remaining)
            except TimeoutError as exc:
                raise BoxError("exec.session handshake timed out") from exc
            except Exception as exc:
                raise BoxError("exec-session closed before start") from exc
            frame = parse_frame(raw)
            if frame is None:
                continue
            kind = frame.get("type")
            if kind == "started":
                pid, exec_id = _started_fields(frame)
                handle = ExecSessionHandle(conn, pid, exec_id, on_stdout, on_stderr)
                handshake_failed = False
                return handle
            if kind == "error":
                raise _handshake_error(frame)
            if kind == "exit":
                raise BoxError("exec-session exited before start")
    finally:
        if handshake_failed:
            with contextlib.suppress(Exception):
                conn.close()
