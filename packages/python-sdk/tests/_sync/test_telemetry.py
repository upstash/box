"""Telemetry header tests for the shared ``_common`` helpers (transport-agnostic)."""

import upstash_box
from upstash_box._common import build_headers, telemetry_headers
from upstash_box._version import __version__

PLATFORM_VARS = [
    "UPSTASH_CONSOLE",
    "VERCEL",
    "CF_PAGES",
    "AWS_LAMBDA_FUNCTION_NAME",
    "AWS_REGION",
    "CI",
]


def _clear_platform_env(monkeypatch):
    monkeypatch.delenv("UPSTASH_DISABLE_TELEMETRY", raising=False)
    for var in PLATFORM_VARS:
        monkeypatch.delenv(var, raising=False)


def test_build_headers_includes_telemetry(monkeypatch):
    _clear_platform_env(monkeypatch)
    headers = build_headers("key")
    assert headers["X-Box-Api-Key"] == "key"
    assert headers["Upstash-Telemetry-Sdk"] == f"upstash-box-py@{__version__}"
    assert headers["Upstash-Telemetry-Runtime"].startswith("python@")
    assert headers["Upstash-Telemetry-Platform"] == "unknown"


def test_version_matches_package(monkeypatch):
    assert upstash_box.__version__ == __version__


def test_opt_out_via_env(monkeypatch):
    monkeypatch.setenv("UPSTASH_DISABLE_TELEMETRY", "1")
    assert telemetry_headers() == {}
    assert build_headers("key") == {"X-Box-Api-Key": "key"}


def test_opt_out_with_empty_value(monkeypatch):
    monkeypatch.setenv("UPSTASH_DISABLE_TELEMETRY", "")
    assert telemetry_headers() == {}


def test_platform_detection(monkeypatch):
    _clear_platform_env(monkeypatch)
    monkeypatch.setenv("VERCEL", "1")
    assert telemetry_headers()["Upstash-Telemetry-Platform"] == "vercel"
    monkeypatch.delenv("VERCEL")
    monkeypatch.setenv("CI", "1")
    assert telemetry_headers()["Upstash-Telemetry-Platform"] == "ci"
