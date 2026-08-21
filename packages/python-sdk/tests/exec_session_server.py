"""Scripted exec-session server backing the async and sync handle tests.

The reply table is shared so both flavors are driven by identical server
behavior; only the socket plumbing differs per test module. A sentinel ``cmd``
in the start frame selects a failure mode for the handshake tests.
"""

import base64
import json
from typing import Any, Dict, List

STARTED = {"type": "started", "pid": 4242, "execId": "exec-abc"}


def b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


def start_replies(start: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Frames sent in response to the opening frame. Echoes the start frame back
    as stdout so tests can assert exactly what the client put on the wire."""
    cmd = start.get("cmd")
    if cmd == "__error__":
        return [{"type": "error", "message": "boom"}]
    if cmd == "__exit__":
        return [{"type": "exit", "code": 7}]
    if cmd == "__close__":
        return []
    return [STARTED, {"type": "stdout", "data": b64(json.dumps(start, sort_keys=True))}]


def replies(msg: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Frames sent in response to one post-handshake client frame."""
    kind = msg.get("type")
    if kind == "stdin":
        return [{"type": "stdout", "data": msg["data"]}]
    if kind == "stdin_close":
        return [{"type": "stderr", "data": b64("eof")}, {"type": "exit", "code": 0}]
    if kind == "signal":
        return [
            {"type": "stdout", "data": b64(f"sig:{msg['signal']}")},
            {"type": "exit", "code": 130},
        ]
    if kind == "terminate":
        return [
            {"type": "stdout", "data": b64(f"term:{msg.get('graceMs', 0)}")},
            {"type": "exit", "code": 143},
        ]
    if kind == "resize":
        return [{"type": "stdout", "data": b64(f"size:{msg['rows']}x{msg['cols']}")}]
    return []
