from upstash_box import Agent, infer_default_provider


def test_openrouter_prefix():
    assert infer_default_provider("openrouter/deepseek-r1") == Agent.CLAUDE_CODE


def test_vercel_anthropic_prefix():
    assert infer_default_provider("vercel/anthropic/claude-opus-4.7") == Agent.CLAUDE_CODE


def test_vercel_openai_prefix():
    assert infer_default_provider("vercel/openai/gpt-5.5") == Agent.CODEX


def test_opencode_prefix():
    assert infer_default_provider("opencode/claude-sonnet-4.5") == Agent.OPEN_CODE


def test_openai_prefix():
    assert infer_default_provider("openai/gpt-5.3-codex") == Agent.CODEX


def test_anthropic_prefix():
    assert infer_default_provider("anthropic/claude-sonnet-4-5") == Agent.CLAUDE_CODE


def test_cursor_prefix():
    assert infer_default_provider("cursor/composer-2.5") == Agent.CURSOR


def test_custom_prefix():
    assert infer_default_provider("custom/demo") == Agent.CUSTOM


def test_unknown_defaults_to_claude_code():
    assert infer_default_provider("mystery-model") == Agent.CLAUDE_CODE


def test_neon_gpt_prefix_infers_codex():
    assert infer_default_provider("neon/gpt-5-5") == Agent.CODEX
    assert infer_default_provider("neon/gpt-5-3-codex") == Agent.CODEX


def test_neon_chat_only_models_infer_opencode():
    assert infer_default_provider("neon/gpt-oss-120b") == Agent.OPEN_CODE
    assert infer_default_provider("neon/gemini-3-6-flash") == Agent.OPEN_CODE
    assert infer_default_provider("neon/kimi-k3") == Agent.OPEN_CODE
    assert infer_default_provider("neon/claude-opus-4-8") == Agent.OPEN_CODE
