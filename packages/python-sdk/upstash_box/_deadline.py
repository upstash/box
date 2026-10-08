"""Run deadlines: a run ``timeout`` is a total wall-clock limit, like the JS SDK.

httpx timeouts apply per socket read, so a run that keeps streaming would never
time out on them alone. Hand-written as an async/sync pair because the async
side needs ``asyncio.wait_for``, which ``scripts/generate_sync.py`` cannot
translate; the generator maps ``anext_before`` to ``next_before`` by name.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any, AsyncIterator, Awaitable, Iterator, Optional, TypeVar

import httpx

from .errors import _CANCELLED_MESSAGE, _RunAbortedError

T = TypeVar("T")


def run_deadline(timeout_ms: Optional[float]) -> Optional[float]:
    """Monotonic deadline for a run ``timeout`` in ms. ``None`` or ``0`` means none."""
    if not timeout_ms:
        return None
    return time.monotonic() + timeout_ms / 1000.0


def _remaining(deadline: float, message: str) -> float:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise _RunAbortedError(message)
    return remaining


def check_deadline(deadline: Optional[float], message: str) -> None:
    """Raise ``_RunAbortedError(message)`` if ``deadline`` has already passed.
    Called before a run request is sent, so an expired run is never submitted."""
    if deadline is not None:
        _remaining(deadline, message)


async def aopen_before(
    opening: Awaitable[httpx.Response],
    deadline: Optional[float],
    message: str,
    run: Any = None,
) -> httpx.Response:
    """Await the response to a run request, bounded by the time left. httpx
    timeouts apply per operation, so connection setup, a slow upload, or a
    server sending headers slowly could otherwise outlast the deadline.

    The open runs as a task stored on ``run._opening`` so that ``run.cancel()``
    from another task interrupts it; that surfaces as
    ``_RunAbortedError("Run cancelled")`` rather than ``CancelledError``.
    """
    if deadline is not None and deadline - time.monotonic() <= 0:
        if hasattr(opening, "close"):
            opening.close()  # never awaited; close the coroutine cleanly
        raise _RunAbortedError(message)
    task = asyncio.ensure_future(opening)
    if run is not None:
        run._opening = task
    try:
        if deadline is None:
            return await task
        return await asyncio.wait_for(task, deadline - time.monotonic())
    except asyncio.TimeoutError:
        raise _RunAbortedError(message) from None
    except asyncio.CancelledError:
        # Our own cancel() cancelled the open; a cancellation of the caller's
        # task (run._cancel_requested unset) still propagates unchanged.
        if run is not None and run._cancel_requested and task.cancelled():
            raise _RunAbortedError(_CANCELLED_MESSAGE) from None
        raise
    finally:
        if run is not None:
            run._opening = None


def open_before(
    response: httpx.Response,
    deadline: Optional[float],
    message: str,
    run: Any = None,
) -> httpx.Response:
    """Sync counterpart of ``aopen_before``. The request has already completed
    here, bounded only by httpx's per-operation timeouts, so this closes the
    response and raises if it arrived after the deadline."""
    if deadline is not None and deadline - time.monotonic() <= 0:
        response.close()
        raise _RunAbortedError(message)
    return response


async def anext_before(iterator: AsyncIterator[T], deadline: Optional[float], message: str) -> T:
    """Next item, or ``_RunAbortedError(message)`` once ``deadline`` passes,
    even while a read is blocked waiting for data."""
    if deadline is None:
        return await iterator.__anext__()
    remaining = _remaining(deadline, message)
    try:
        item = await asyncio.wait_for(iterator.__anext__(), remaining)
    except asyncio.TimeoutError:
        raise _RunAbortedError(message) from None
    except StopAsyncIteration:
        # wait_for cannot fire while parsing runs without yielding to the loop,
        # so EOF reached after the deadline is a timeout, not a completed run.
        _remaining(deadline, message)
        raise
    _remaining(deadline, message)
    return item


def next_before(iterator: Iterator[T], deadline: Optional[float], message: str) -> T:
    """Sync counterpart of ``anext_before``. A blocking read cannot be
    interrupted here, so the deadline is checked before and after each read; a
    stream that goes silent is still bounded by the request's read timeout,
    which is set to the run timeout."""
    if deadline is None:
        return next(iterator)
    _remaining(deadline, message)
    try:
        item = next(iterator)
    except StopIteration:
        # EOF that arrived after the deadline is a timeout, not a completed run.
        _remaining(deadline, message)
        raise
    # So is an event (including an error event) that arrived after it.
    _remaining(deadline, message)
    return item
