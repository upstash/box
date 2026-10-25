"""hermes-box: Hermes Agent terminal backend that runs commands in an Upstash Box.

Select it with ``terminal.backend: upstash_box`` after setting ``UPSTASH_BOX_API_KEY``. See README.md.
"""

from __future__ import annotations

from .provider import UpstashBoxProvider


def register(ctx) -> None:
    ctx.register_terminal_environment_provider(UpstashBoxProvider())
