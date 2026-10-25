"""The ``upstash_box`` terminal backend provider: classification, health checks and environment creation."""

from __future__ import annotations

import importlib.util
import logging
from typing import Any, Optional

from agent.terminal_env_provider import TerminalEnvironmentProvider

logger = logging.getLogger(__name__)

BACKEND_NAME = "upstash_box"
API_KEY_ENV = "UPSTASH_BOX_API_KEY"
BASE_URL_ENV = "UPSTASH_BOX_BASE_URL"
CONSOLE_URL = "https://console.upstash.com"
SIZES = ("small", "medium", "large")


def _terminal_config() -> dict:
    from hermes_cli.config import load_config_readonly

    terminal = load_config_readonly().get("terminal")
    return terminal if isinstance(terminal, dict) else {}


def _as_bool(value: Any, default: bool = False) -> bool:
    if value is None or value == "":
        return default
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _as_list(value: Any) -> list[str]:
    if value is None or value == "":
        return []
    if isinstance(value, str):
        return [part.strip() for part in value.split(",") if part.strip()]
    if isinstance(value, (list, tuple)):
        return [str(part).strip() for part in value if str(part).strip()]
    return []


def settings() -> dict[str, Any]:
    """The ``terminal.upstash_box_*`` keys from config.yaml, normalized, with defaults."""
    try:
        terminal = _terminal_config()
    except Exception as exc:  # unreadable config: defaults still work
        logger.debug("Upstash Box: could not read config.yaml: %s", exc)
        terminal = {}
    size = str(terminal.get("upstash_box_size") or "small").strip().lower()
    if size not in SIZES:
        logger.warning("Upstash Box: terminal.upstash_box_size %r is not one of %s; using small", size, SIZES)
        size = "small"
    return {
        "size": size,
        "runtime": str(terminal.get("upstash_box_runtime") or "").strip() or None,
        "keep_alive": _as_bool(terminal.get("upstash_box_keep_alive")),
        "labels": _as_list(terminal.get("upstash_box_labels")),
        "name_prefix": str(terminal.get("upstash_box_name_prefix") or "hermes").strip() or "hermes",
    }


def _secret(name: str) -> Optional[str]:
    from agent.secret_scope import get_secret

    value = get_secret(name)
    return value.strip() if isinstance(value, str) and value.strip() else None


def sdk_installed() -> bool:
    try:
        return importlib.util.find_spec("upstash_box") is not None
    except (ImportError, ValueError):
        return False


def api_key_present() -> bool:
    try:
        return _secret(API_KEY_ENV) is not None
    except Exception:
        return False


class UpstashBoxProvider(TerminalEnvironmentProvider):
    """Upstash Box: a cloud container per task, resumed by name when persistence is on."""

    # Commands run in the Box's own Linux filesystem, not the host's.
    is_remote = True
    is_container = True
    # Boxes are resumed by name; non-persistent sessions must never share one.
    session_isolated_when_nonpersistent = True
    # No local argv reaches a Box session with stdin/stdout open, so Bot Desktop stays off.
    supports_streams = False

    @property
    def name(self) -> str:
        return BACKEND_NAME

    @property
    def display_name(self) -> str:
        return "Upstash Box"

    @property
    def description(self) -> str:
        return "Run commands in an Upstash Box cloud container (resumable, pausable)."

    @property
    def env_description(self) -> str:
        return "an Upstash Box cloud container (Linux)"

    @property
    def cache_path_base(self) -> Optional[str]:
        return "~/.hermes"

    @property
    def default_cwd(self) -> Optional[str]:
        return "~"

    @property
    def strip_env_keys(self) -> frozenset:
        return frozenset({API_KEY_ENV})

    def is_available(self) -> bool:
        # Cheap and offline: the SDK is importable and a key is configured. No API call.
        return sdk_installed() and api_key_present()

    def check_requirements(self, config: dict[str, Any]) -> bool:
        if not sdk_installed():
            logger.error(
                "Upstash Box backend selected but the upstash-box package is not installed. "
                "Reinstall the plugin or run: pip install 'upstash-box>=0.4,<1'"
            )
            return False
        if not api_key_present():
            logger.error(
                "Upstash Box backend selected but %s is not set. Create a Box API key at %s "
                "and add it to ~/.hermes/.env",
                API_KEY_ENV,
                CONSOLE_URL,
            )
            return False
        return True

    def probe(self) -> tuple[str, str]:
        try:
            if not sdk_installed():
                return ("unavailable", "The upstash-box Python package is not installed.")
            if not api_key_present():
                return ("needs_setup", f"Set {API_KEY_ENV} (create a key at {CONSOLE_URL}).")
            return ("ready", "")
        except Exception as exc:  # probe must never raise
            return ("unavailable", str(exc))

    def setup_instructions(self) -> list[str]:
        cfg = settings()
        lines = [
            f"{API_KEY_ENV} is set."
            if api_key_present()
            else f"Set {API_KEY_ENV} in ~/.hermes/.env (create a Box API key at {CONSOLE_URL}).",
            f"Box size: {cfg['size']} (change it with `hermes config set terminal.upstash_box_size medium`).",
            "With terminal.container_persistent: true (the default) each task's Box is paused on exit and "
            "resumed next time; with false every session gets its own Box, deleted when the session ends.",
        ]
        if not sdk_installed():
            lines.insert(0, "The upstash-box package is missing: pip install 'upstash-box>=0.4,<1'.")
        return lines

    def doctor_checks(self) -> list[tuple[bool, str, str]]:
        sdk, key = sdk_installed(), api_key_present()
        return [
            (sdk, "Upstash Box SDK", "(upstash-box installed)" if sdk else "(missing: pip install upstash-box)"),
            (
                key,
                "Upstash Box API key",
                f"({API_KEY_ENV} set)" if key else f"({API_KEY_ENV} not set; see {CONSOLE_URL})",
            ),
        ]

    def create_environment(
        self,
        *,
        cwd: str,
        timeout: int,
        task_id: str = "default",
        image: Optional[str] = None,
        container_config: Optional[dict[str, Any]] = None,
        **kwargs: Any,
    ):
        from .upstash_box_env import DEFAULT_BASE_URL, UpstashBoxEnvironment

        cc = container_config or {}
        cfg = settings()
        api_key = _secret(API_KEY_ENV)
        if not api_key:
            raise RuntimeError(f"Upstash Box backend: {API_KEY_ENV} is not set (create a key at {CONSOLE_URL}).")
        # A per-task image override (batch runs) names a Box runtime, the closest Box concept.
        runtime = (image or "").strip() or cfg["runtime"]
        return UpstashBoxEnvironment(
            cwd=cwd or "~",
            timeout=timeout,
            task_id=task_id or "default",
            persistent=_as_bool(cc.get("container_persistent"), default=True),
            size=cfg["size"],
            runtime=runtime,
            keep_alive=cfg["keep_alive"],
            labels=cfg["labels"],
            name_prefix=cfg["name_prefix"],
            api_key=api_key,
            # Always explicit: without it the SDK reads UPSTASH_BOX_BASE_URL from os.environ,
            # which under profile multiplexing may be another profile's endpoint.
            base_url=_secret(BASE_URL_ENV) or DEFAULT_BASE_URL,
        )
