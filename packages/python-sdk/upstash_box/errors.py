from __future__ import annotations

from typing import Optional


class BoxError(Exception):
    """Error raised by the Box SDK."""

    def __init__(self, message: str, status_code: Optional[int] = None) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code

    def __str__(self) -> str:  # pragma: no cover - trivial
        return self.message


class _RunAbortedError(BoxError):
    """A run that stopped because its ``timeout`` elapsed or ``cancel()`` was
    called. It is never retried: the run may still be executing server-side, so
    a retry would start a second billed run. Internal; callers see ``BoxError``."""
