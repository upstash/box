"""Shared, transport-agnostic helpers used by both the async and sync clients.

No ``await`` here — this module is imported verbatim by both clients.
"""

from __future__ import annotations

import os
import sys
from typing import Any, Dict, List, Mapping, Optional, Tuple, cast

import httpx

from ._version import __version__
from .errors import BoxError
from .types import Agent, NetworkPolicy

DEFAULT_BASE_URL = "https://us-east-1.box.upstash.com"
WORKSPACE = "/workspace/home"

_TELEMETRY_RUNTIME = "python@{}.{}.{}".format(*sys.version_info[:3])


def _telemetry_platform() -> str:
    if os.environ.get("UPSTASH_CONSOLE"):
        return "console"
    if os.environ.get("VERCEL"):
        return "vercel"
    if os.environ.get("CF_PAGES"):
        return "cloudflare"
    if os.environ.get("AWS_LAMBDA_FUNCTION_NAME") or os.environ.get("AWS_REGION"):
        return "aws"
    if os.environ.get("CI"):
        return "ci"
    return "unknown"


def telemetry_headers() -> Dict[str, str]:
    """Anonymous client telemetry (SDK version, runtime, platform), following
    the same header convention as the other Upstash SDKs. No user data or
    request payloads are ever collected.

    Disable by setting the ``UPSTASH_DISABLE_TELEMETRY`` environment variable.
    """
    if "UPSTASH_DISABLE_TELEMETRY" in os.environ:
        return {}
    return {
        "Upstash-Telemetry-Sdk": f"upstash-box-py@{__version__}",
        "Upstash-Telemetry-Runtime": _TELEMETRY_RUNTIME,
        "Upstash-Telemetry-Platform": _telemetry_platform(),
    }


def resolve_base_url(base_url: Optional[str]) -> str:
    url = base_url or os.environ.get("UPSTASH_BOX_BASE_URL") or DEFAULT_BASE_URL
    return url.rstrip("/")


def resolve_api_key(api_key: Optional[str]) -> str:
    key = api_key or os.environ.get("UPSTASH_BOX_API_KEY")
    if not key:
        raise BoxError("api_key is required. Pass it in config or set UPSTASH_BOX_API_KEY env var.")
    return key


def build_headers(api_key: str) -> Dict[str, str]:
    return {"X-Box-Api-Key": api_key, **telemetry_headers()}


def parse_error_response(response: httpx.Response) -> str:
    try:
        data = response.json()
        if isinstance(data, dict) and data.get("error"):
            return str(data["error"])
    except Exception:
        pass
    return f"Request failed with status {response.status_code}"


def raise_for_status(response: httpx.Response) -> None:
    if not response.is_success:
        raise BoxError(parse_error_response(response), response.status_code)


# ==================== Provider inference ====================


def infer_default_provider(model: str) -> Agent:
    """Infer the default harness from a model string prefix."""
    if model.startswith("custom/"):
        return Agent.CUSTOM
    if model.startswith("cursor/"):
        return Agent.CURSOR
    if model.startswith("vercel/openai/"):
        return Agent.CODEX
    if model.startswith("vercel/"):
        return Agent.CLAUDE_CODE
    if model.startswith("openrouter/"):
        return Agent.CLAUDE_CODE
    if model.startswith("opencode/"):
        return Agent.OPEN_CODE
    if model.startswith("openai/"):
        return Agent.CODEX
    if model.startswith("anthropic/"):
        return Agent.CLAUDE_CODE
    return Agent.CLAUDE_CODE


# ==================== Agent config ====================

# Harnesses whose backend agent_options use camelCase keys (Claude Code, OpenCode).
# Codex uses snake_case keys, which already match the SDK's snake_case option API,
# so its options pass through unchanged.
_CAMEL_OPTION_HARNESSES = {Agent.CLAUDE_CODE.value, Agent.OPEN_CODE.value}


def _agent_value(agent: Any) -> Optional[str]:
    if isinstance(agent, Agent):
        return agent.value
    return agent


def _snake_to_camel(key: str) -> str:
    head, *tail = key.split("_")
    return head + "".join(part[:1].upper() + part[1:] for part in tail)


def to_backend_agent_options(agent: Optional[Any], options: Mapping[str, Any]) -> Dict[str, Any]:
    """Convert the SDK's snake_case agent options into the keys the backend
    expects for the given harness: Claude Code / OpenCode use camelCase, Codex
    (and others) use snake_case (passed through unchanged)."""
    if _agent_value(agent) in _CAMEL_OPTION_HARNESSES:
        return {_snake_to_camel(k): v for k, v in options.items()}
    return dict(options)


def is_custom_agent_harness(agent: Optional[Mapping[str, Any]]) -> bool:
    if not agent:
        return False
    return _agent_value(agent.get("harness")) == Agent.CUSTOM.value


def resolve_agent_harness(agent: Optional[Mapping[str, Any]]) -> Optional[str]:
    # harness-only — the JS deprecated provider/runner aliases are not supported.
    if not agent:
        return None
    harness = agent.get("harness")
    if not harness:
        raise BoxError("agent.harness is required.")
    return _agent_value(harness)


def resolve_agent_model(agent: Mapping[str, Any]) -> str:
    if is_custom_agent_harness(agent):
        return agent.get("model") or "custom"
    model = agent.get("model")
    if not model:
        raise BoxError("agent.model is required when agent is configured")
    return _agent_value(model) or ""


def append_agent_config_to_body(body: Dict[str, Any], agent: Mapping[str, Any]) -> None:
    body["model"] = resolve_agent_model(agent)
    body["agent"] = resolve_agent_harness(agent)
    if is_custom_agent_harness(agent):
        custom = agent.get("custom_harness")
        if not custom:
            raise BoxError("agent.custom_harness is required when agent.harness is custom")
        body["custom_runner"] = _serialize_custom_harness(custom)
    else:
        if agent.get("api_key") is not None:
            body["agent_api_key"] = _agent_value(agent.get("api_key"))


def _serialize_custom_harness(custom: Mapping[str, Any]) -> Dict[str, Any]:
    out: Dict[str, Any] = {"command": custom["command"]}
    if custom.get("args") is not None:
        out["args"] = custom["args"]
    if custom.get("protocol") is not None:
        out["protocol"] = custom["protocol"]
    return out


# ==================== Network policy ====================


def serialize_network_policy(policy: Mapping[str, Any]) -> Dict[str, Any]:
    if policy.get("mode") == "custom":
        return {
            "mode": "custom",
            "allowed_domains": policy.get("allowed_domains"),
            "allowed_cidrs": policy.get("allowed_cidrs"),
            "denied_cidrs": policy.get("denied_cidrs"),
        }
    return {"mode": policy["mode"]}


def deserialize_network_policy(raw: Optional[Mapping[str, Any]]) -> NetworkPolicy:
    if not raw:
        return cast(NetworkPolicy, {"mode": "allow-all"})
    if raw.get("mode") == "custom":
        return cast(
            NetworkPolicy,
            {
                "mode": "custom",
                "allowed_domains": raw.get("allowed_domains"),
                "allowed_cidrs": raw.get("allowed_cidrs"),
                "denied_cidrs": raw.get("denied_cidrs"),
            },
        )
    return cast(NetworkPolicy, {"mode": raw["mode"]})


# ==================== MCP servers ====================


def serialize_mcp_servers(servers: List[Mapping[str, Any]]) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for s in servers:
        if s.get("package"):
            out.append(
                {
                    "name": s["name"],
                    "source": "npm",
                    "package_or_url": s["package"],
                    "args": s.get("args"),
                }
            )
        elif s.get("url"):
            out.append(
                {
                    "name": s["name"],
                    "source": "url",
                    "package_or_url": s["url"],
                    "headers": s.get("headers"),
                }
            )
        else:
            raise BoxError(
                f"mcp_servers entry {s.get('name')!r} must include either 'package' or 'url'"
            )
    return out


# ==================== Structured output ====================


def to_json_schema(schema: Any) -> Optional[Dict[str, Any]]:
    """Convert a response_schema (pydantic BaseModel subclass or raw dict) into a
    JSON Schema dict for the API's ``json_schema`` parameter. Returns None when
    the schema can't be interpreted."""
    if schema is None:
        return None
    # Raw JSON-schema dict — send as-is.
    if isinstance(schema, dict):
        return schema
    # Pydantic BaseModel subclass.
    try:
        from pydantic import BaseModel

        if isinstance(schema, type) and issubclass(schema, BaseModel):
            result = dict(schema.model_json_schema())
            result.pop("$schema", None)
            result.pop("title", None)
            return result
    except Exception:
        pass
    return None


def parse_structured_output(schema: Any, output: str) -> Any:
    """Validate/parse a structured-output string against the response_schema."""
    import json

    try:
        from pydantic import BaseModel

        if isinstance(schema, type) and issubclass(schema, BaseModel):
            return schema.model_validate_json(output)
    except BoxError:
        raise
    except Exception as e:
        raise BoxError(
            f"Failed to parse structured output: {e}\n\nRaw output: {output[:500]}"
        ) from e
    # Raw dict schema (or anything else): parse JSON and return the value.
    try:
        return json.loads(output)
    except Exception as e:
        raise BoxError(
            f"Failed to parse structured output: {e}\n\nRaw output: {output[:500]}"
        ) from e


# ==================== Prompt files / run request ====================

MIME_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".csv": "text/csv",
    ".txt": "text/plain",
    ".json": "application/json",
    ".xml": "application/xml",
    ".html": "text/html",
    ".md": "text/markdown",
    ".ts": "text/plain",
    ".js": "text/plain",
    ".py": "text/plain",
}


def is_file_paths(files: Any) -> bool:
    """True when PromptFiles are local file paths (list[str]) vs base64 objects."""
    return bool(files) and isinstance(files[0], str)


def prepare_run_request(
    request_body: Dict[str, Any], files: Optional[Any]
) -> Tuple[str, Dict[str, Any], Optional[List[str]]]:
    """Decide how to encode a run request.

    Returns a tuple ``(mode, body, file_paths)``:
      - ``("json", body, None)`` — plain JSON (no files, or base64 objects merged in)
      - ``("multipart", scalar_fields, file_paths)`` — local file paths; the client
        reads the files and builds the httpx multipart body.
    """
    if files:
        if is_file_paths(files):
            return "multipart", request_body, list(files)
        request_body = dict(request_body)
        request_body["files"] = [
            {
                "data": f["data"],
                "media_type": f["media_type"],
                "filename": f.get("filename"),
            }
            for f in files
        ]
    return "json", request_body, None


def multipart_field_data(request_body: Dict[str, Any]) -> Dict[str, str]:
    """Flatten scalar run-request fields into multipart form fields (JSON-encode
    non-string values), mirroring buildMultipartBody in the JS SDK."""
    import json

    data: Dict[str, str] = {}
    for key, value in request_body.items():
        if value is None:
            continue
        data[key] = value if isinstance(value, str) else json.dumps(value)
    return data


def mime_for_path(path: str) -> str:
    ext = os.path.splitext(path)[1].lower()
    return MIME_TYPES.get(ext, "application/octet-stream")
