"""Shared types for the Box SDK — enums, config TypedDicts, Pydantic response
models, streaming chunk dataclasses, and run/stream option TypedDicts.

This module contains no ``await`` and is shared verbatim by the async and sync
clients. Enum string values mirror ``packages/sdk/src/types.ts`` exactly.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict
from typing_extensions import NotRequired, TypedDict

# ==================== Runtime / size ====================

# Defaults use Debian (glibc, wider binary compatibility). Append ``-alpine`` for
# the smaller musl-based image of the same runtime.
Runtime = Literal[
    "node",
    "python",
    "golang",
    "ruby",
    "rust",
    "node-alpine",
    "python-alpine",
    "golang-alpine",
    "ruby-alpine",
    "rust-alpine",
]
BoxSize = Literal["small", "medium", "large"]


# ==================== Enums ====================


class Agent(str, Enum):
    """Agent harnesses available for boxes."""

    CLAUDE_CODE = "claude-code"
    CODEX = "codex"
    OPEN_CODE = "opencode"
    CURSOR = "cursor"
    CUSTOM = "custom"


class ClaudeCode(str, Enum):
    """Claude Code model identifiers."""

    FABLE_5 = "anthropic/claude-fable-5"
    OPUS_4_5 = "anthropic/claude-opus-4-5"
    OPUS_4_6 = "anthropic/claude-opus-4-6"
    OPUS_4_7 = "anthropic/claude-opus-4-7"
    OPUS_4_8 = "anthropic/claude-opus-4-8"
    SONNET_4 = "anthropic/claude-sonnet-4"
    SONNET_4_5 = "anthropic/claude-sonnet-4-5"
    SONNET_4_6 = "anthropic/claude-sonnet-4-6"
    SONNET_5 = "anthropic/claude-sonnet-5"
    HAIKU_4_5 = "anthropic/claude-haiku-4-5"


class OpenAICodex(str, Enum):
    """OpenAI Codex model identifiers."""

    GPT_5_6 = "openai/gpt-5.6"
    GPT_5_6_SOL = "openai/gpt-5.6-sol"
    GPT_5_6_TERRA = "openai/gpt-5.6-terra"
    GPT_5_6_LUNA = "openai/gpt-5.6-luna"
    GPT_5_5 = "openai/gpt-5.5"
    GPT_5_4 = "openai/gpt-5.4"
    GPT_5_4_MINI = "openai/gpt-5.4-mini"
    GPT_5_3_CODEX = "openai/gpt-5.3-codex"
    GPT_5_3_CODEX_SPARK = "openai/gpt-5.3-codex-spark"
    GPT_5_2_CODEX = "openai/gpt-5.2-codex"
    GPT_5_1_CODEX_MAX = "openai/gpt-5.1-codex-max"
    GPT_5_1_CODEX_MINI = "openai/gpt-5.1-codex-mini"


class OpenRouterModel(str, Enum):
    """OpenRouter model identifiers — shared across agents that support OpenRouter."""

    CLAUDE_FABLE_5 = "openrouter/anthropic/claude-fable-5"
    CLAUDE_SONNET_5 = "openrouter/anthropic/claude-sonnet-5"
    CLAUDE_SONNET_4 = "openrouter/anthropic/claude-sonnet-4"
    CLAUDE_OPUS_4_5 = "openrouter/anthropic/claude-opus-4-5"
    CLAUDE_HAIKU_4_5 = "openrouter/anthropic/claude-haiku-4-5"
    DEEPSEEK_R1 = "openrouter/deepseek/deepseek-r1"
    GEMINI_2_5_PRO = "openrouter/google/gemini-2.5-pro"
    GEMINI_2_5_FLASH = "openrouter/google/gemini-2.5-flash"
    GPT_5_6_SOL = "openrouter/openai/gpt-5.6-sol"
    GPT_5_6_TERRA = "openrouter/openai/gpt-5.6-terra"
    GPT_5_6_LUNA = "openrouter/openai/gpt-5.6-luna"
    GPT_4_1 = "openrouter/openai/gpt-4.1"
    O3 = "openrouter/openai/o3"
    O4_MINI = "openrouter/openai/o4-mini"


class VercelModel(str, Enum):
    """Vercel AI Gateway model identifiers."""

    CLAUDE_FABLE_5 = "vercel/anthropic/claude-fable-5"
    CLAUDE_SONNET_5 = "vercel/anthropic/claude-sonnet-5"
    CLAUDE_OPUS_4_7 = "vercel/anthropic/claude-opus-4.7"
    CLAUDE_SONNET_4_6 = "vercel/anthropic/claude-sonnet-4.6"
    CLAUDE_OPUS_4_6 = "vercel/anthropic/claude-opus-4.6"
    CLAUDE_HAIKU_4_5 = "vercel/anthropic/claude-haiku-4.5"
    GPT_5_6_SOL = "vercel/openai/gpt-5.6-sol"
    GPT_5_6_TERRA = "vercel/openai/gpt-5.6-terra"
    GPT_5_6_LUNA = "vercel/openai/gpt-5.6-luna"
    GPT_5_5 = "vercel/openai/gpt-5.5"
    GPT_5_5_PRO = "vercel/openai/gpt-5.5-pro"
    GPT_5_4 = "vercel/openai/gpt-5.4"
    GPT_5_4_MINI = "vercel/openai/gpt-5.4-mini"
    GEMINI_3_5_FLASH = "vercel/google/gemini-3.5-flash"
    GEMINI_3_1_FLASH_LITE = "vercel/google/gemini-3.1-flash-lite"
    GEMINI_3_1_PRO_PREVIEW = "vercel/google/gemini-3.1-pro-preview"
    GROK_BUILD_0_1 = "vercel/xai/grok-build-0.1"
    GROK_4_3 = "vercel/xai/grok-4.3"
    GROK_4_20_REASONING = "vercel/xai/grok-4.20-reasoning"


class OpenCodeModel(str, Enum):
    """OpenCode model identifiers — supports models from multiple providers."""

    # Anthropic-backed OpenCode models
    CLAUDE_FABLE_5 = "opencode/claude-fable-5"
    CLAUDE_OPUS_4_5 = "opencode/claude-opus-4-5"
    CLAUDE_OPUS_4_6 = "opencode/claude-opus-4-6"
    CLAUDE_OPUS_4_7 = "opencode/claude-opus-4-7"
    CLAUDE_OPUS_4_8 = "opencode/claude-opus-4-8"
    CLAUDE_SONNET_4 = "opencode/claude-sonnet-4"
    CLAUDE_SONNET_4_5 = "opencode/claude-sonnet-4-5"
    CLAUDE_SONNET_4_6 = "opencode/claude-sonnet-4-6"
    CLAUDE_SONNET_5 = "opencode/claude-sonnet-5"
    CLAUDE_HAIKU_4_5 = "opencode/claude-haiku-4-5"
    # OpenAI-backed OpenCode models
    GPT_5_5 = "opencode/gpt-5.5"
    GPT_5_4 = "opencode/gpt-5.4"
    GPT_5_4_PRO = "opencode/gpt-5.4-pro"
    GPT_5_4_MINI = "opencode/gpt-5.4-mini"
    GPT_5_4_NANO = "opencode/gpt-5.4-nano"
    GPT_5_3_CODEX = "opencode/gpt-5.3-codex"
    GPT_5_3_CODEX_SPARK = "opencode/gpt-5.3-codex-spark"
    GPT_5_2_CODEX = "opencode/gpt-5.2-codex"
    GPT_5_1_CODEX_MAX = "opencode/gpt-5.1-codex-max"
    GPT_5_1_CODEX_MINI = "opencode/gpt-5.1-codex-mini"
    GPT_4_1 = "opencode/gpt-4.1"
    O3 = "opencode/o3"
    O4_MINI = "opencode/o4-mini"
    # Free models
    ZEN_GPT_5_NANO = "opencode/gpt-5-nano"
    ZEN_BIG_PICKLE = "opencode/big-pickle"
    # Paid models
    ZEN_MINIMAX_M2_7 = "opencode/minimax-m2.7"
    ZEN_CLAUDE_FABLE_5 = "opencode/claude-fable-5"
    ZEN_CLAUDE_SONNET_4_6 = "opencode/claude-sonnet-4-6"
    ZEN_CLAUDE_SONNET_4_5 = "opencode/claude-sonnet-4-5"
    ZEN_CLAUDE_SONNET_4 = "opencode/claude-sonnet-4"
    ZEN_CLAUDE_SONNET_5 = "opencode/claude-sonnet-5"
    ZEN_CLAUDE_HAIKU_4_5 = "opencode/claude-haiku-4-5"
    ZEN_CLAUDE_OPUS_4_8 = "opencode/claude-opus-4-8"
    ZEN_CLAUDE_OPUS_4_7 = "opencode/claude-opus-4-7"
    ZEN_CLAUDE_OPUS_4_6 = "opencode/claude-opus-4-6"
    ZEN_CLAUDE_OPUS_4_5 = "opencode/claude-opus-4-5"
    ZEN_CLAUDE_OPUS_4_1 = "opencode/claude-opus-4-1"
    ZEN_GEMINI_3_1_PRO = "opencode/gemini-3.1-pro"
    ZEN_GEMINI_3_PRO = "opencode/gemini-3-pro"
    ZEN_GEMINI_3_FLASH = "opencode/gemini-3-flash"


class CursorModel(str, Enum):
    """Cursor model identifiers."""

    DEFAULT = "cursor/default"
    COMPOSER_2_5 = "cursor/composer-2.5"
    GPT_5_5 = "cursor/gpt-5.5"
    GPT_5_4 = "cursor/gpt-5.4"
    GPT_5_4_MINI = "cursor/gpt-5.4-mini"
    GPT_5_4_NANO = "cursor/gpt-5.4-nano"
    GPT_5_3_CODEX = "cursor/gpt-5.3-codex"
    GPT_5_3_CODEX_SPARK = "cursor/gpt-5.3-codex-spark"
    GPT_5_2 = "cursor/gpt-5.2"
    GPT_5_2_CODEX = "cursor/gpt-5.2-codex"
    GPT_5_1 = "cursor/gpt-5.1"
    GPT_5_1_CODEX_MAX = "cursor/gpt-5.1-codex-max"
    GPT_5_1_CODEX_MINI = "cursor/gpt-5.1-codex-mini"
    GPT_5_MINI = "cursor/gpt-5-mini"
    CLAUDE_FABLE_5 = "cursor/claude-fable-5"
    CLAUDE_OPUS_4_8 = "cursor/claude-opus-4-8"
    CLAUDE_OPUS_4_7 = "cursor/claude-opus-4-7"
    CLAUDE_OPUS_4_6 = "cursor/claude-opus-4-6"
    CLAUDE_OPUS_4_5 = "cursor/claude-opus-4-5"
    CLAUDE_SONNET_4_6 = "cursor/claude-sonnet-4-6"
    CLAUDE_SONNET_4_5 = "cursor/claude-sonnet-4-5"
    CLAUDE_SONNET_4 = "cursor/claude-sonnet-4"
    CLAUDE_SONNET_5 = "cursor/claude-sonnet-5"
    CLAUDE_HAIKU_4_5 = "cursor/claude-haiku-4-5"
    GEMINI_3_1_PRO = "cursor/gemini-3.1-pro"
    GEMINI_3_FLASH = "cursor/gemini-3-flash"
    GEMINI_2_5_FLASH = "cursor/gemini-2.5-flash"
    GROK_4_20 = "cursor/grok-4-20"
    KIMI_K2_5 = "cursor/kimi-k2.5"


class BoxApiKey(str, Enum):
    """Managed LLM API key selection."""

    UPSTASH_KEY = "UPSTASH_KEY"
    STORED_KEY = "STORED_KEY"


# ==================== Config TypedDicts (inputs) ====================


class CustomHarnessConfig(TypedDict):
    """Custom harness process contract."""

    command: str
    args: NotRequired[List[str]]
    protocol: NotRequired[Literal["box-sse-v1"]]


class GitConfigInput(TypedDict):
    token: NotRequired[str]
    user_name: NotRequired[str]
    user_email: NotRequired[str]


class AgentConfig(TypedDict):
    """Agent configuration for a box. ``harness`` is required; ``model`` is
    required for managed harnesses (optional/defaulted for custom)."""

    harness: Union[Agent, str]
    model: NotRequired[str]
    api_key: NotRequired[Union[BoxApiKey, str]]
    custom_harness: NotRequired[CustomHarnessConfig]


class McpServerConfig(TypedDict):
    """MCP server configuration — either a local package or a remote URL."""

    name: str
    package: NotRequired[str]
    args: NotRequired[List[str]]
    url: NotRequired[str]
    headers: NotRequired[Dict[str, str]]


class AllowDenyNetworkPolicy(TypedDict):
    mode: Literal["allow-all", "deny-all"]


class CustomNetworkPolicy(TypedDict):
    mode: Literal["custom"]
    allowed_domains: NotRequired[List[str]]
    allowed_cidrs: NotRequired[List[str]]
    denied_cidrs: NotRequired[List[str]]


# Discriminated on ``mode`` (mirrors the JS union): allow-all/deny-all take no
# extra fields; custom takes the optional allow/deny lists.
NetworkPolicy = Union[AllowDenyNetworkPolicy, CustomNetworkPolicy]


class WebhookConfig(TypedDict):
    url: str
    headers: NotRequired[Dict[str, str]]


# ==================== Prompt files ====================


class Base64FileInput(TypedDict):
    data: str
    media_type: str
    filename: NotRequired[str]


# Files to attach to a prompt: either local file paths (list[str]) or base64 objects.
PromptFiles = Union[List[str], List[Base64FileInput]]


# ==================== Run / stream options ====================


class ToolUsePayload(TypedDict):
    """Payload passed to an ``on_tool_use`` callback."""

    tool_call_id: Optional[str]
    name: str
    input: Dict[str, Any]


class ToolResultPayload(TypedDict):
    """Payload passed to an ``on_tool_result`` callback."""

    tool_call_id: Optional[str]
    output: Any


ToolUseCallback = Callable[[ToolUsePayload], None]
ToolResultCallback = Callable[[ToolResultPayload], None]


# Agent-specific options forwarded to the underlying harness. Keys are snake_case
# (Pythonic public API); the SDK converts them to the backend's expected casing
# per harness (Claude Code / OpenCode -> camelCase, Codex -> snake_case). Mirrors
# the JS SDK's *AgentOptions, but snake_case instead of JS camelCase. Note: only
# top-level keys are converted — keys inside nested dicts (e.g. `thinking`) are
# forwarded verbatim.
class ClaudeCodeAgentOptions(TypedDict, total=False):
    max_turns: int
    max_budget_usd: float
    effort: Literal["low", "medium", "high", "max"]
    thinking: Dict[str, Any]
    disallowed_tools: List[str]
    agents: Dict[str, Any]
    prompt_suggestions: bool
    fallback_model: str
    system_prompt: Union[str, Dict[str, Any]]


class CodexAgentOptions(TypedDict, total=False):
    model_reasoning_effort: Literal["none", "minimal", "low", "medium", "high", "xhigh"]
    model_reasoning_summary: Literal["auto", "concise", "detailed", "none"]
    personality: Literal["friendly", "pragmatic", "none"]
    web_search: Union[bool, Literal["live"]]


class OpenCodeAgentOptions(TypedDict, total=False):
    reasoning_effort: Literal["low", "medium", "high"]
    text_verbosity: Literal["low", "medium", "high"]
    reasoning_summary: Literal["auto", "concise", "detailed", "none"]
    thinking: Dict[str, Any]


# Cursor has no fixed option schema (mirrors the JS Record<string, unknown>).
CursorAgentOptions = Dict[str, Any]


# Union of the known per-harness option shapes plus a raw-dict escape hatch (the
# options are forwarded verbatim, so arbitrary keys remain allowed). Note: unlike
# the JS `AgentOptions<TProvider>` generic, Python does not resolve options by
# harness, so completion shows the union of all shapes rather than harness-specific.
AgentOptions = Union[
    ClaudeCodeAgentOptions,
    CodexAgentOptions,
    OpenCodeAgentOptions,
    Dict[str, Any],
]

# response_schema accepts a pydantic BaseModel subclass or a raw JSON-schema dict.
ResponseSchema = Union[type[BaseModel], Dict[str, Any]]


class RunOptions(TypedDict):
    prompt: str
    response_schema: NotRequired[ResponseSchema]
    files: NotRequired[PromptFiles]
    options: NotRequired[AgentOptions]
    timeout: NotRequired[float]
    max_retries: NotRequired[int]
    on_tool_use: NotRequired[ToolUseCallback]
    on_tool_result: NotRequired[ToolResultCallback]
    webhook: NotRequired[WebhookConfig]


class StreamOptions(TypedDict):
    prompt: str
    files: NotRequired[PromptFiles]
    options: NotRequired[AgentOptions]
    timeout: NotRequired[float]
    on_tool_use: NotRequired[ToolUseCallback]
    on_tool_result: NotRequired[ToolResultCallback]


# ==================== Code execution ====================

CodeLanguage = Literal["js", "ts", "python"]


# ==================== Run state ====================

RunStatus = Literal["running", "completed", "failed", "cancelled", "detached"]


@dataclass
class RunCost:
    input_tokens: int = 0
    output_tokens: int = 0
    cached_input_tokens: int = 0
    compute_ms: float = 0
    total_usd: float = 0


@dataclass
class RunLog:
    timestamp: str
    level: Literal["info", "warn", "error"]
    message: str


# ==================== Streaming chunks (tagged union) ====================


@dataclass(frozen=True)
class StartChunk:
    run_id: str
    type: Literal["start"] = "start"


@dataclass(frozen=True)
class TextDeltaChunk:
    text: str
    type: Literal["text-delta"] = "text-delta"


@dataclass(frozen=True)
class ReasoningChunk:
    text: str
    type: Literal["reasoning"] = "reasoning"


@dataclass(frozen=True)
class ToolCallChunk:
    tool_name: str
    input: Dict[str, Any] = field(default_factory=dict)
    tool_call_id: Optional[str] = None
    type: Literal["tool-call"] = "tool-call"


@dataclass(frozen=True)
class ToolResultChunk:
    output: Any = None
    tool_call_id: Optional[str] = None
    type: Literal["tool-result"] = "tool-result"


@dataclass(frozen=True)
class FinishUsage:
    input_tokens: int = 0
    output_tokens: int = 0
    cached_input_tokens: int = 0


@dataclass(frozen=True)
class FinishChunk:
    output: str
    usage: FinishUsage
    session_id: str = ""
    type: Literal["finish"] = "finish"


@dataclass(frozen=True)
class StatsChunk:
    cpu_ns: int = 0
    memory_peak_bytes: int = 0
    type: Literal["stats"] = "stats"


@dataclass(frozen=True)
class UnknownChunk:
    event: str
    data: Any = None
    type: Literal["unknown"] = "unknown"


Chunk = Union[
    StartChunk,
    TextDeltaChunk,
    ReasoningChunk,
    ToolCallChunk,
    ToolResultChunk,
    FinishChunk,
    StatsChunk,
    UnknownChunk,
]


@dataclass(frozen=True)
class ExecOutputChunk:
    data: str
    type: Literal["output"] = "output"


@dataclass(frozen=True)
class ExecExitChunk:
    exit_code: int
    cpu_ns: int = 0
    type: Literal["exit"] = "exit"


ExecStreamChunk = Union[ExecOutputChunk, ExecExitChunk]


# ==================== Pydantic response models (outputs) ====================


class _Model(BaseModel):
    model_config = ConfigDict(extra="allow")


class FileEntry(_Model):
    name: str
    path: str
    size: int
    is_dir: bool
    mod_time: str


class GitConfigResult(_Model):
    git_user_name: str
    git_user_email: str


class GitCommitResult(_Model):
    sha: str
    message: str


class PullRequest(_Model):
    url: str
    number: int
    title: str
    base: str


class Snapshot(_Model):
    id: str
    name: str
    box_id: str
    size_bytes: int
    status: Literal["creating", "ready", "error", "deleted"]
    created_at: int


class LogEntry(_Model):
    timestamp: int
    level: Literal["info", "warn", "error"]
    source: Literal["system", "agent", "user"]
    message: str


class PublicURL(_Model):
    # `url`/`port` are present on the create response; the list endpoint
    # (GET /preview) returns leaner records, so both are optional.
    url: Optional[str] = None
    port: Optional[int] = None
    token: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None


class BoxData(_Model):
    id: str
    status: str
    created_at: int
    updated_at: int
    name: Optional[str] = None
    size: Optional[str] = None
    keep_alive: Optional[bool] = None
    model: Optional[str] = None
    agent: Optional[str] = None
    enabled_skills: Optional[List[str]] = None
    runtime: Optional[str] = None
    network_policy: Optional[Dict[str, Any]] = None
    session_id: Optional[str] = None


class EphemeralBoxData(BoxData):
    ephemeral: Optional[bool] = None
    expires_at: int = 0


class BoxRunData(_Model):
    id: str
    box_id: str
    customer_id: str
    type: Literal["agent", "shell"]
    status: str
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0
    duration_ms: float = 0
    created_at: int = 0
    prompt: Optional[str] = None
    model: Optional[str] = None
    output: Optional[str] = None
    cached_input_tokens: Optional[int] = None
    cpu_ns: Optional[int] = None
    compute_cost_usd: Optional[float] = None
    memory_peak_bytes: Optional[int] = None
    error_message: Optional[str] = None
    session_id: Optional[str] = None
    schedule_id: Optional[str] = None
    completed_at: Optional[int] = None


ScheduleStatus = Literal["active", "paused", "deleted"]


class Schedule(_Model):
    id: str
    box_id: str
    type: Literal["exec", "prompt"]
    cron: str
    status: ScheduleStatus
    total_runs: int = 0
    total_failures: int = 0
    created_at: int = 0
    updated_at: int = 0
    customer_id: Optional[str] = None
    command: Optional[List[str]] = None
    prompt: Optional[str] = None
    folder: Optional[str] = None
    model: Optional[str] = None
    agent_options: Optional[Dict[str, Any]] = None
    timeout: Optional[float] = None
    qstash_schedule_id: Optional[str] = None
    webhook_url: Optional[str] = None
    webhook_headers: Optional[Dict[str, str]] = None
    last_run_at: Optional[int] = None
    last_run_status: Optional[Literal["completed", "failed", "skipped"]] = None
    last_run_id: Optional[str] = None


# ==================== Schedule options (inputs) ====================


class ExecScheduleOptions(TypedDict):
    cron: str
    command: List[str]
    folder: NotRequired[str]
    webhook_url: NotRequired[str]
    webhook_headers: NotRequired[Dict[str, str]]


class AgentScheduleOptions(TypedDict):
    cron: str
    prompt: str
    folder: NotRequired[str]
    model: NotRequired[str]
    options: NotRequired[AgentOptions]
    timeout: NotRequired[float]
    webhook_url: NotRequired[str]
    webhook_headers: NotRequired[Dict[str, str]]


# ==================== Box config / connection (inputs) ====================


class UploadFileEntry(TypedDict):
    """A local file to upload into the box."""

    path: str
    destination: str


class ModelConfig(TypedDict):
    """Returned by ``box.model_config``."""

    harness: Optional[str]
    model: Optional[str]


class BoxConnectionOptions(TypedDict, total=False):
    """Shared auth/endpoint options for the static methods."""

    api_key: str
    base_url: str


class BoxGetOptions(TypedDict, total=False):
    """Options for ``Box.get`` / ``get_by_name``."""

    api_key: str
    base_url: str
    git_token: str
    timeout: float
    debug: bool


class BoxConfig(TypedDict, total=False):
    """Configuration for ``Box.create`` / ``Box.from_snapshot``."""

    api_key: str
    base_url: str
    name: str
    runtime: Runtime
    size: BoxSize
    keep_alive: bool
    init_command: str
    agent: AgentConfig
    git: GitConfigInput
    env: Dict[str, str]
    attach_headers: Dict[str, Dict[str, str]]
    network_policy: NetworkPolicy
    skills: List[str]
    mcp_servers: List[McpServerConfig]
    timeout: float
    debug: bool


class EphemeralBoxConfig(TypedDict, total=False):
    """Configuration for ``EphemeralBox.create`` / ``from_snapshot``."""

    api_key: str
    base_url: str
    name: str
    runtime: Runtime
    size: BoxSize
    ttl: int
    env: Dict[str, str]
    attach_headers: Dict[str, Dict[str, str]]
    network_policy: NetworkPolicy
    timeout: float
    debug: bool
