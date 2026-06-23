"""Tests for transport-agnostic helpers in upstash_box._common."""

import pytest
from pydantic import BaseModel

from upstash_box import Agent, BoxError
from upstash_box._common import (
    append_agent_config_to_body,
    deserialize_network_policy,
    is_file_paths,
    prepare_run_request,
    resolve_agent_model,
    serialize_mcp_servers,
    serialize_network_policy,
    to_backend_agent_options,
    to_json_schema,
)


def test_serialize_network_policy_simple():
    assert serialize_network_policy({"mode": "deny-all"}) == {"mode": "deny-all"}


def test_serialize_network_policy_custom():
    out = serialize_network_policy(
        {"mode": "custom", "allowed_domains": ["a.com"], "denied_cidrs": ["10.0.0.0/8"]}
    )
    assert out == {
        "mode": "custom",
        "allowed_domains": ["a.com"],
        "allowed_cidrs": None,
        "denied_cidrs": ["10.0.0.0/8"],
    }


def test_deserialize_network_policy_default():
    assert deserialize_network_policy(None) == {"mode": "allow-all"}


def test_deserialize_network_policy_custom():
    out = deserialize_network_policy({"mode": "custom", "allowed_domains": ["a.com"]})
    assert out["mode"] == "custom"
    assert out["allowed_domains"] == ["a.com"]


def test_codex_options_pass_through_snake_case():
    # Codex backend uses snake_case, which matches the SDK's public option keys.
    out = to_backend_agent_options(Agent.CODEX, {"model_reasoning_effort": "high"})
    assert out == {"model_reasoning_effort": "high"}


def test_claude_code_options_snake_to_camel():
    # Claude Code backend uses camelCase; snake_case public keys are converted.
    out = to_backend_agent_options(
        Agent.CLAUDE_CODE, {"max_turns": 5, "max_budget_usd": 1.5, "system_prompt": "x"}
    )
    assert out == {"maxTurns": 5, "maxBudgetUsd": 1.5, "systemPrompt": "x"}


def test_opencode_options_snake_to_camel():
    out = to_backend_agent_options(
        Agent.OPEN_CODE, {"reasoning_effort": "high", "text_verbosity": "low"}
    )
    assert out == {"reasoningEffort": "high", "textVerbosity": "low"}


def test_resolve_agent_model_requires_model():
    with pytest.raises(BoxError, match="agent.model is required"):
        resolve_agent_model({"harness": Agent.CLAUDE_CODE})


def test_resolve_agent_model_custom_defaults():
    assert resolve_agent_model({"harness": Agent.CUSTOM}) == "custom"


def test_append_agent_config_managed():
    body = {}
    append_agent_config_to_body(
        body,
        {"harness": Agent.CLAUDE_CODE, "model": "anthropic/claude-sonnet-4-5", "api_key": "sk"},
    )
    assert body == {
        "model": "anthropic/claude-sonnet-4-5",
        "agent": "claude-code",
        "agent_api_key": "sk",
    }


def test_append_agent_config_custom():
    body = {}
    append_agent_config_to_body(
        body, {"harness": Agent.CUSTOM, "custom_harness": {"command": "my-agent"}}
    )
    assert body["agent"] == "custom"
    assert body["custom_runner"] == {"command": "my-agent"}


def test_append_agent_config_custom_requires_harness():
    with pytest.raises(BoxError, match="custom_harness is required"):
        append_agent_config_to_body({}, {"harness": Agent.CUSTOM})


def test_serialize_mcp_servers():
    out = serialize_mcp_servers(
        [
            {"name": "fs", "package": "@modelcontextprotocol/server-filesystem"},
            {"name": "remote", "url": "https://mcp.example.com"},
        ]
    )
    assert out[0]["source"] == "npm"
    assert out[0]["package_or_url"] == "@modelcontextprotocol/server-filesystem"
    assert out[1]["source"] == "url"
    assert out[1]["package_or_url"] == "https://mcp.example.com"


def test_is_file_paths():
    assert is_file_paths(["./a.png"]) is True
    assert is_file_paths([{"data": "x", "media_type": "image/png"}]) is False


def test_prepare_run_request_no_files():
    mode, body, paths = prepare_run_request({"prompt": "hi"}, None)
    assert mode == "json"
    assert paths is None


def test_prepare_run_request_base64():
    mode, body, paths = prepare_run_request(
        {"prompt": "hi"}, [{"data": "abc", "media_type": "image/png", "filename": "x.png"}]
    )
    assert mode == "json"
    assert body["files"] == [{"data": "abc", "media_type": "image/png", "filename": "x.png"}]


def test_prepare_run_request_paths():
    mode, body, paths = prepare_run_request({"prompt": "hi"}, ["./a.png", "./b.pdf"])
    assert mode == "multipart"
    assert paths == ["./a.png", "./b.pdf"]


def test_to_json_schema_pydantic():
    class M(BaseModel):
        name: str

    schema = to_json_schema(M)
    assert schema["type"] == "object"
    assert "$schema" not in schema
    assert "title" not in schema


def test_to_json_schema_raw_dict_passthrough():
    raw = {"type": "object"}
    assert to_json_schema(raw) is raw
