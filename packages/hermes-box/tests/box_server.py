"""A local stand-in for the Upstash Box API, driven by the real ``upstash-box`` SDK.

REST calls go through an ``httpx.MockTransport`` installed in the SDK's sync client, so they never
leave the process. Exec sessions go over a real WebSocket to a local ``websockets`` server, so the
SDK's own session handle (one reader thread, close joins it) runs unmodified. Boxes are temporary
directories and commands are local processes. Only the endpoints this plugin uses exist.
"""

from __future__ import annotations

import base64
import contextlib
import itertools
import json
import os
import re
import signal
import subprocess
import threading
from email import policy
from email.parser import BytesParser
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import parse_qs

import httpx
from websockets.sync.server import serve

_SIGNALS = {"KILL": signal.SIGKILL, "TERM": signal.SIGTERM, "INT": signal.SIGINT, "HUP": signal.SIGHUP}


def _json(status: int, payload) -> httpx.Response:
    return httpx.Response(status, json=payload)


class BoxServer:
    def __init__(self, root: Path):
        self.root = root
        self.boxes: dict[str, dict] = {}
        self.requests: list[SimpleNamespace] = []
        self.ws_requests: list[SimpleNamespace] = []
        self.sessions: list[SimpleNamespace] = []
        self.reads: list[tuple] = []
        # (method, action) -> list of HTTP statuses to answer with, consumed one per request.
        self.failures: dict[tuple[str, str], list[int]] = {}
        # Close the WebSocket right after "started" (a dropped connection mid-command).
        self.drop_sessions = False
        self._ids = itertools.count(1)
        self._server = serve(self._session, "127.0.0.1", 0)
        self.port = self._server.socket.getsockname()[1]
        threading.Thread(target=self._server.serve_forever, daemon=True).start()

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def close(self) -> None:
        self._server.shutdown()

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self._handle)

    def box(self, key: str) -> dict | None:
        box = self.boxes.get(key) or next((b for b in self.boxes.values() if b["name"] == key), None)
        return None if box is None or box["status"] == "deleted" else box

    def env(self, box: dict) -> dict:
        return {"HOME": box["home"], "PATH": os.environ.get("PATH", "/usr/bin:/bin"), "LANG": "C.UTF-8"}

    # --- REST -----------------------------------------------------------------------------
    def _handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        self.requests.append(SimpleNamespace(method=request.method, url=request.url, headers=dict(request.headers)))
        match = re.fullmatch(r"/v2/box(?:/([^/]+)(?:/(.+))?)?", path)
        if not match:
            return _json(404, {"error": "no route"})
        key, action = match.group(1), match.group(2) or ""
        failures = self.failures.get((request.method, action or ("box" if key else "")))
        if failures:
            return _json(failures.pop(0), {"error": "injected failure"})
        if key is None and request.method == "POST":
            return self._create(json.loads(request.content))
        box = self.box(key)
        if box is None:
            return _json(404, {"error": f"box {key} not found"})
        query = {k: v[0] for k, v in parse_qs(request.url.query.decode()).items()}
        if action == "" and request.method == "GET":
            return _json(200, self._public(box))
        if action == "" and request.method == "DELETE":
            box["status"] = "deleted"
            return _json(200, {})
        if action == "status":
            return _json(200, {"status": box["status"]})
        if action in ("pause", "resume"):
            box["status"] = "paused" if action == "pause" else "running"
            return _json(200, {})
        if action == "exec":
            body = json.loads(request.content)
            done = subprocess.run(body["command"], cwd=box["home"], env=self.env(box), capture_output=True, check=False)
            return _json(
                200,
                {"exit_code": done.returncode, "output": done.stdout.decode(), "error": done.stderr.decode()},
            )
        if action == "files/stat":
            st = os.stat(query["path"])
            return _json(200, {"type": "file", "size": st.st_size, "mod_time": "", "inode": st.st_ino, "version": "1"})
        if action == "files/read":
            offset, length = int(query.get("offset", 0)), query.get("length")
            self.reads.append((query["path"], offset, length))
            with open(query["path"], "rb") as fh:
                fh.seek(offset)
                data = fh.read() if length is None else fh.read(int(length))
            return _json(200, {"content": base64.b64encode(data).decode()})
        if action == "files/upload":
            return self._upload(request)
        return _json(404, {"error": f"no route {request.method} {action}"})

    def _public(self, box: dict) -> dict:
        return {k: box[k] for k in ("id", "name", "status", "keep_alive", "size")}

    def _create(self, body: dict) -> httpx.Response:
        box_id = f"box-{next(self._ids)}"
        home = self.root / box_id
        home.mkdir(parents=True)
        self.boxes[box_id] = {
            "id": box_id,
            "name": body.get("name") or box_id,
            "status": "running",
            "keep_alive": bool(body.get("keep_alive")),
            "size": body.get("size") or "small",
            "home": str(home),
            "body": body,
        }
        return _json(200, self._public(self.boxes[box_id]))

    def _upload(self, request: httpx.Request) -> httpx.Response:
        head = f"Content-Type: {request.headers['content-type']}\r\n\r\n".encode()
        message = BytesParser(policy=policy.default).parsebytes(head + request.content)
        paths, contents = [], []
        for part in message.iter_parts():
            name = part.get_param("name", header="content-disposition")
            if name == "paths":
                paths.append(part.get_content().strip())
            elif name == "files":
                contents.append(part.get_payload(decode=True))
        for dest, data in zip(paths, contents, strict=True):
            Path(dest).write_bytes(data)
        return _json(200, {})

    # --- Exec sessions --------------------------------------------------------------------
    def _session(self, ws) -> None:
        self.ws_requests.append(SimpleNamespace(path=ws.request.path, headers=dict(ws.request.headers)))
        match = re.fullmatch(r"/v2/box/([^/]+)/exec-session", ws.request.path)
        box = self.box(match.group(1)) if match else None
        start = json.loads(ws.recv())
        if box is None:
            ws.send(json.dumps({"type": "error", "message": "box not found"}))
            return
        proc = subprocess.Popen(
            start["argv"],
            cwd=box["home"],
            env=self.env(box),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
        )
        record = SimpleNamespace(argv=start["argv"], stdin=bytearray(), stdin_closed=False, signals=[], code=None)
        self.sessions.append(record)
        send_lock = threading.Lock()

        def send(frame) -> None:
            with send_lock, contextlib.suppress(Exception):
                ws.send(json.dumps(frame))

        def kill(sig) -> None:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(proc.pid, sig)

        def pump(stream, kind) -> None:
            for chunk in iter(lambda: stream.read1(65536), b""):
                send({"type": kind, "data": base64.b64encode(chunk).decode()})

        def receive() -> None:
            try:
                for raw in ws:
                    frame = json.loads(raw)
                    kind = frame.get("type")
                    if kind == "stdin":
                        data = base64.b64decode(frame["data"])
                        record.stdin += data
                        with contextlib.suppress(OSError):
                            proc.stdin.write(data)
                            proc.stdin.flush()
                    elif kind == "stdin_close":
                        record.stdin_closed = True
                        with contextlib.suppress(OSError):
                            proc.stdin.close()
                    elif kind == "signal":
                        record.signals.append(frame["signal"])
                        kill(_SIGNALS[frame["signal"]])
            except Exception:
                pass
            # The session owns the process: a closed connection kills it.
            kill(signal.SIGKILL)

        send({"type": "started", "pid": proc.pid, "execId": f"exec-{len(self.sessions)}"})
        if self.drop_sessions:
            kill(signal.SIGKILL)
            proc.wait()
            ws.close()
            return
        pumps = [
            threading.Thread(target=pump, args=(proc.stdout, "stdout"), daemon=True),
            threading.Thread(target=pump, args=(proc.stderr, "stderr"), daemon=True),
        ]
        for thread in pumps:
            thread.start()
        threading.Thread(target=receive, daemon=True).start()
        code = proc.wait()
        for thread in pumps:
            thread.join(timeout=5)
        record.code = code if code >= 0 else 128 - code
        send({"type": "exit", "code": record.code})


class _HttpxWithTransport:
    """The ``httpx`` module as the SDK sees it, with every ``Client`` bound to one transport."""

    def __init__(self, transport: httpx.MockTransport):
        self._transport = transport

    def Client(self, *args, **kwargs):  # noqa: N802 - mirrors httpx.Client
        kwargs["transport"] = self._transport
        return httpx.Client(*args, **kwargs)

    def __getattr__(self, name):
        return getattr(httpx, name)


def install(server: BoxServer, monkeypatch) -> None:
    """Route the real SDK's sync client through ``server``."""
    import upstash_box._sync.client as sync_client

    monkeypatch.setattr(sync_client, "httpx", _HttpxWithTransport(server.transport()))
