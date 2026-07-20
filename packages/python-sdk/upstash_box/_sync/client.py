# DO NOT EDIT — generated from upstash_box/_async/ by scripts/generate_sync.py.
# Edit the async source and re-run the generator. Hand-written sync code that
# can't be generated cleanly belongs in upstash_box/_sync/_fallbacks.py.
"""Generated synchronous client — DO NOT EDIT.

Produced from upstash_box/_async/ by scripts/generate_sync.py. Edit the async
source and re-run the generator."""

from __future__ import annotations

import time
import json
import logging
import os
import uuid
from typing import Any, Iterator, Dict, Generic, List, Mapping, Optional, TypeVar, Union

import httpx
from typing_extensions import Unpack

from .. import _common as common
from ..errors import BoxError
from ..types import (
    Agent,
    AgentOptions,
    BoxConfig,
    BoxConnectionOptions,
    BoxData,
    BoxGetOptions,
    BoxRunData,
    Chunk,
    CodeLanguage,
    CustomHarnessConfig,
    EphemeralBoxConfig,
    ExecExitChunk,
    ExecOutputChunk,
    ExecStreamChunk,
    FileEntry,
    FinishChunk,
    FinishUsage,
    GitCommitResult,
    GitConfigResult,
    ListOptions,
    LogEntry,
    ModelConfig,
    NetworkPolicy,
    PromptFiles,
    PublicURL,
    PullRequest,
    ReasoningChunk,
    ResponseSchema,
    RunCost,
    RunLog,
    RunStatus,
    Schedule,
    Snapshot,
    StartChunk,
    StatsChunk,
    TextDeltaChunk,
    ToolCallChunk,
    ToolResultCallback,
    ToolResultChunk,
    ToolUseCallback,
    UnknownChunk,
    UploadFileEntry,
    WebhookConfig,
)
from ._sse import iter_exec_stream, iter_sse_events

_logger = logging.getLogger("upstash_box")

T = TypeVar("T")

WORKSPACE = common.WORKSPACE
_DEFAULT_TIMEOUT_MS = 600000


def _resolve_tool_call_id(parsed: Dict[str, Any]) -> Optional[str]:
    for key in ("tool_call_id", "tool_use_id", "toolCallId", "id"):
        value = parsed.get(key)
        if isinstance(value, str):
            return value
    return None


def _normalize_path(p: str) -> str:
    resolved: List[str] = []
    for part in p.split("/"):
        if part == "" or part == ".":
            continue
        if part == "..":
            if resolved:
                resolved.pop()
        else:
            resolved.append(part)
    return "/" + "/".join(resolved)


class Run(Generic[T]):
    """A single agent or shell execution returned by ``agent.run`` / ``exec.command``."""

    def __init__(self, box: "Box", type_: str, id: Optional[str] = None) -> None:
        self._id = id or str(uuid.uuid4())
        self.type = type_
        self._box = box
        self._result: Optional[T] = None
        self._status: RunStatus = "running"
        self._exit_code: Optional[int] = None
        self._input_tokens = 0
        self._output_tokens = 0
        self._cached_input_tokens = 0
        self._total_usd = 0.0
        self._compute_ms = 0.0
        self._start_time = time.time() * 1000

    @property
    def id(self) -> str:
        return self._id

    @property
    def status(self) -> RunStatus:
        return self._status

    @property
    def result(self) -> Any:
        if self._result is None:
            return ""
        return self._result

    @property
    def exit_code(self) -> Optional[int]:
        return self._exit_code

    @property
    def cost(self) -> RunCost:
        return RunCost(
            input_tokens=self._input_tokens,
            output_tokens=self._output_tokens,
            cached_input_tokens=self._cached_input_tokens,
            compute_ms=self._compute_ms or (time.time() * 1000 - self._start_time),
            total_usd=self._total_usd,
        )

    def cancel(self) -> None:
        try:
            self._box._request("POST", f"/v2/box/{self._box.id}/runs/{self._id}/cancel")
        except Exception:
            pass
        self._status = "cancelled"

    def logs(self) -> List[RunLog]:
        all_logs = self._box.logs()
        start_sec = int(self._start_time / 1000)
        out: List[RunLog] = []
        for entry in all_logs:
            if entry.timestamp >= start_sec:
                iso = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(entry.timestamp)) + ".000Z"
                out.append(RunLog(timestamp=iso, level=entry.level, message=entry.message))
        return out


class StreamRun(Run[T]):
    """A streaming run that yields typed chunks in real time.

    Iterable: the async client is async-iterable; the generated sync ``StreamRun``
    is a plain iterable. Python does not run a generator's ``finally`` when you
    ``break`` out of a loop (unlike JS ``for await``), so to finalize status
    (e.g. ``detached``) after early termination, close the run
    (``aclose()`` async / ``close()`` sync) or use it as a context manager.
    """

    def __init__(self, box: "Box", type_: str, id: Optional[str] = None) -> None:
        super().__init__(box, type_, id)
        self._iterator: Optional[Any] = None

    def __iter__(self) -> Iterator[Any]:
        assert self._iterator is not None
        return self._iterator

    def close(self) -> None:
        if self._iterator is not None:
            self._iterator.close()

    def __enter__(self) -> "StreamRun":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()


class AgentNamespace:
    def __init__(self, box: "Box") -> None:
        self._box = box

    def run(
        self,
        *,
        prompt: str,
        response_schema: Optional[ResponseSchema] = None,
        files: Optional[PromptFiles] = None,
        options: Optional[AgentOptions] = None,
        timeout: Optional[float] = None,
        max_retries: int = 0,
        on_tool_use: Optional[ToolUseCallback] = None,
        on_tool_result: Optional[ToolResultCallback] = None,
        webhook: Optional[WebhookConfig] = None,
    ) -> Run[Any]:
        self._box._require_agent()
        if not prompt:
            raise BoxError("prompt is required")
        if webhook:
            return self._box._execute_webhook_run(prompt, response_schema, files, options, webhook)
        return self._box._run_with_retries(
            prompt,
            response_schema,
            files,
            options,
            timeout,
            max_retries,
            on_tool_use,
            on_tool_result,
        )

    def stream(
        self,
        *,
        prompt: str,
        files: Optional[PromptFiles] = None,
        options: Optional[AgentOptions] = None,
        timeout: Optional[float] = None,
        on_tool_use: Optional[ToolUseCallback] = None,
        on_tool_result: Optional[ToolResultCallback] = None,
    ) -> StreamRun[str]:
        self._box._require_agent()
        if not prompt:
            raise BoxError("prompt is required")
        return self._box._stream(prompt, files, options, timeout, on_tool_use, on_tool_result)


class ExecNamespace:
    def __init__(self, box: "Box") -> None:
        self._box = box

    def command(self, command: str) -> Run[str]:
        return self._box._exec_command(command)

    def code(self, *, code: str, lang: CodeLanguage, timeout: Optional[float] = None) -> Run[str]:
        return self._box._exec_code(code, lang, timeout)

    def stream(self, command: str) -> StreamRun[str]:
        return self._box._exec_stream(command)

    def stream_code(
        self, *, code: str, lang: CodeLanguage, timeout: Optional[float] = None
    ) -> StreamRun[str]:
        return self._box._exec_stream_code(code, lang, timeout)


class FilesNamespace:
    def __init__(self, box: "Box") -> None:
        self._box = box

    def read(self, path: str, *, encoding: Optional[str] = None) -> str:
        return self._box._read_file(path, encoding)

    def write(self, *, path: str, content: str, encoding: Optional[str] = None) -> None:
        self._box._write_file(path, content, encoding)

    def list(self, path: Optional[str] = None) -> List[FileEntry]:
        return self._box._list_files(path)

    def upload(self, files: List[UploadFileEntry]) -> None:
        self._box._upload_files(files)

    def download(self, *, folder: Optional[str] = None) -> None:
        self._box._download_files(folder)


class GitNamespace:
    def __init__(self, box: "Box") -> None:
        self._box = box

    def clone(self, *, repo: str, branch: Optional[str] = None) -> None:
        self._box._git_clone(repo, branch)

    def diff(self) -> str:
        return self._box._git_diff()

    def status(self) -> str:
        return self._box._git_status()

    def commit(
        self,
        *,
        message: str,
        author_name: Optional[str] = None,
        author_email: Optional[str] = None,
    ) -> GitCommitResult:
        return self._box._git_commit(message, author_name, author_email)

    def update_config(
        self, *, user_name: Optional[str] = None, user_email: Optional[str] = None
    ) -> GitConfigResult:
        return self._box._git_update_config(user_name, user_email)

    def push(self, *, branch: Optional[str] = None) -> None:
        self._box._git_push(branch)

    def create_pr(
        self, *, title: str, body: Optional[str] = None, base: Optional[str] = None
    ) -> PullRequest:
        return self._box._git_create_pr(title, body, base)

    def exec(self, *, args: List[str]) -> str:
        return self._box._git_exec(args)

    def checkout(self, *, branch: str) -> None:
        self._box._git_checkout(branch)


class ScheduleNamespace:
    def __init__(self, box: "Box") -> None:
        self._box = box

    def exec(
        self,
        *,
        cron: str,
        command: List[str],
        folder: Optional[str] = None,
        webhook_url: Optional[str] = None,
        webhook_headers: Optional[Dict[str, str]] = None,
    ) -> Schedule:
        return self._box._schedule_exec(
            {
                "cron": cron,
                "command": command,
                "folder": folder,
                "webhook_url": webhook_url,
                "webhook_headers": webhook_headers,
            }
        )

    def agent(
        self,
        *,
        cron: str,
        prompt: str,
        folder: Optional[str] = None,
        model: Optional[str] = None,
        options: Optional[AgentOptions] = None,
        timeout: Optional[float] = None,
        webhook_url: Optional[str] = None,
        webhook_headers: Optional[Dict[str, str]] = None,
    ) -> Schedule:
        return self._box._schedule_agent(
            {
                "cron": cron,
                "prompt": prompt,
                "folder": folder,
                "model": model,
                "options": options,
                "timeout": timeout,
                "webhook_url": webhook_url,
                "webhook_headers": webhook_headers,
            }
        )

    def list(self) -> List[Schedule]:
        return self._box._schedule_list()

    def get(self, id: str) -> Schedule:
        return self._box._schedule_get(id)

    def pause(self, id: str) -> None:
        self._box._schedule_pause(id)

    def resume(self, id: str) -> None:
        self._box._schedule_resume(id)

    def delete(self, id: str) -> None:
        self._box._schedule_delete(id)


class SkillsNamespace:
    def __init__(self, box: "Box") -> None:
        self._box = box

    def add(self, skill_id: str) -> None:
        self._box._skill_add(skill_id)

    def remove(self, skill_id: str) -> None:
        self._box._skill_remove(skill_id)

    def list(self) -> List[str]:
        return self._box._skill_list()


class LabelsNamespace:
    def __init__(self, box: "Box") -> None:
        self._box = box

    def add(self, label: str) -> List[str]:
        """Add a label. Returns the box's updated label set."""
        return self._box._label_add(label)

    def remove(self, label: str) -> List[str]:
        """Remove a label. Returns the box's updated label set."""
        return self._box._label_remove(label)

    def list(self) -> List[str]:
        """List this box's labels."""
        return self._box._label_list()


class Box(Generic[T]):
    """A sandboxed AI coding environment."""

    def __init__(self, data: Dict[str, Any], config: Dict[str, Any]) -> None:
        self.id = data["id"]
        self.size = data.get("size") or "small"
        self.keep_alive = bool(data.get("keep_alive"))
        self._cwd = WORKSPACE
        self._network_policy = common.deserialize_network_policy(data.get("network_policy"))
        self._model = data.get("model")
        self._agent = data.get("agent")
        self._base_url = config["base_url"]
        self._headers = config["headers"]
        self._timeout_ms = config.get("timeout", _DEFAULT_TIMEOUT_MS)
        self._debug = config.get("debug", False)
        self._git_token = config.get("git_token")
        self._is_agent_configured = config.get("is_agent_configured", False)
        self._client: httpx.Client = config["client"]

        self.agent = AgentNamespace(self)
        self.exec = ExecNamespace(self)
        self.files = FilesNamespace(self)
        self.git = GitNamespace(self)
        self.schedule = ScheduleNamespace(self)
        self.skills = SkillsNamespace(self)
        self.labels = LabelsNamespace(self)

    # ==================== Lifecycle / transport ====================

    @property
    def cwd(self) -> str:
        return self._cwd

    @property
    def network_policy(self) -> NetworkPolicy:
        return self._network_policy

    @property
    def model_config(self) -> ModelConfig:
        return {"harness": self._agent, "model": self._model}

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "Box":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def _require_agent(self) -> None:
        if not self._is_agent_configured:
            raise BoxError(
                "No agent configured. Pass an `agent` option to create() to use box.agent.run()."
            )

    def _require_keep_alive(self, feature: str) -> None:
        if not self.keep_alive:
            raise BoxError(f"{feature} is only available for keep-alive boxes")

    def _log(self, *args: Any) -> None:
        if self._debug:
            _logger.debug("[Box] %s", " ".join(str(a) for a in args))

    # ==================== HTTP ====================

    def _request(
        self,
        method: str,
        path: str,
        *,
        body: Any = None,
        timeout: Optional[float] = None,
    ) -> Any:
        url = f"{self._base_url}{path}"
        headers = dict(self._headers)
        content = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            content = json.dumps(body)
        self._log(method, url)
        try:
            response = self._client.request(
                method,
                url,
                headers=headers,
                content=content,
                timeout=_ms_to_seconds(self._timeout_ms if timeout is None else timeout),
            )
        except httpx.TimeoutException as e:
            raise BoxError("Request timeout") from e
        except BoxError:
            raise
        except Exception as e:
            raise BoxError(str(e)) from e
        common.raise_for_status(response)
        text = response.text
        if not text:
            return {}
        return json.loads(text)

    # ==================== Run ====================

    def _run_with_retries(
        self,
        prompt,
        response_schema,
        files,
        options,
        timeout,
        max_retries,
        on_tool_use,
        on_tool_result,
    ) -> Run[Any]:
        last_error: Optional[Exception] = None
        for attempt in range(max_retries + 1):
            try:
                return self._execute_run(
                    prompt,
                    response_schema,
                    files,
                    options,
                    timeout,
                    on_tool_use,
                    on_tool_result,
                )
            except Exception as e:
                last_error = e
                if attempt < max_retries:
                    delay = min(1.0 * (2**attempt), 30.0)
                    time.sleep(delay)
        assert last_error is not None
        raise last_error

    def _execute_run(
        self,
        prompt,
        response_schema,
        files,
        options,
        timeout,
        on_tool_use,
        on_tool_result,
    ) -> Run[Any]:
        start = time.time() * 1000
        run: Run[Any] = Run(self, "agent")

        request_body: Dict[str, Any] = {"prompt": prompt}
        folder = self._get_folder()
        if folder:
            request_body["folder"] = folder
        if response_schema is not None:
            schema = common.to_json_schema(response_schema)
            if schema:
                request_body["json_schema"] = schema
        if options:
            request_body["agent_options"] = common.to_backend_agent_options(self._agent, options)

        raw_output = ""
        request = self._build_run_stream_request(request_body, files, timeout)
        response = self._open_stream(request)
        try:
            for event_type, data in iter_sse_events(response):
                parsed = _safe_json(data)
                if parsed is None:
                    continue
                if event_type == "run_start":
                    if parsed.get("run_id"):
                        run._id = parsed["run_id"]
                elif event_type == "text":
                    raw_output += parsed.get("text") or ""
                elif event_type == "tool":
                    if on_tool_use:
                        on_tool_use(
                            {
                                "tool_call_id": _resolve_tool_call_id(parsed),
                                "name": parsed.get("name") or "",
                                "input": parsed.get("input") or {},
                            }
                        )
                elif event_type == "tool_result":
                    if on_tool_result:
                        on_tool_result(
                            {
                                "tool_call_id": _resolve_tool_call_id(parsed),
                                "output": parsed.get("output"),
                            }
                        )
                elif event_type == "done":
                    run._input_tokens = parsed.get("input_tokens") or 0
                    run._output_tokens = parsed.get("output_tokens") or 0
                    run._cached_input_tokens = parsed.get("cached_input_tokens") or 0
                    run._total_usd = parsed.get("total_cost_usd") or 0
                    if parsed.get("output"):
                        raw_output = parsed["output"]
                elif event_type == "error":
                    raise BoxError(parsed.get("error") or "Stream error")
        finally:
            response.close()

        output: Any = raw_output.strip()
        if response_schema is not None:
            output = common.parse_structured_output(response_schema, output)

        run._result = output
        run._status = "completed"
        run._compute_ms = time.time() * 1000 - start
        return run

    def _execute_webhook_run(self, prompt, response_schema, files, options, webhook) -> Run[Any]:
        run: Run[Any] = Run(self, "agent")
        request_body: Dict[str, Any] = {"prompt": prompt}
        folder = self._get_folder()
        if folder:
            request_body["folder"] = folder
        if response_schema is not None:
            schema = common.to_json_schema(response_schema)
            if schema:
                request_body["json_schema"] = schema
        if options:
            request_body["agent_options"] = common.to_backend_agent_options(self._agent, options)
        request_body["webhook"] = (
            {"url": webhook["url"], "headers": webhook["headers"]}
            if webhook.get("headers")
            else {"url": webhook["url"]}
        )

        mode, prepared, file_paths = common.prepare_run_request(request_body, files)
        url = f"{self._base_url}/v2/box/{self.id}/run"
        response = self._post_run(url, mode, prepared, file_paths)
        common.raise_for_status(response)
        data = response.json()
        if data.get("run_id"):
            run._id = data["run_id"]
        run._status = "running"
        return run

    def _stream(
        self, prompt, files, options, timeout, on_tool_use, on_tool_result
    ) -> StreamRun[str]:
        start = time.time() * 1000
        run: StreamRun[str] = StreamRun(self, "agent")

        request_body: Dict[str, Any] = {"prompt": prompt}
        folder = self._get_folder()
        if folder:
            request_body["folder"] = folder
        if options:
            request_body["agent_options"] = common.to_backend_agent_options(self._agent, options)

        box: "Box" = self

        def iterate() -> Iterator[Chunk]:
            raw_output = ""
            finished = False
            request = box._build_run_stream_request(request_body, files, timeout)
            response = box._open_stream(request)
            try:
                for event_type, data in iter_sse_events(response):
                    parsed = _safe_json(data)
                    if parsed is None:
                        continue
                    if event_type == "run_start":
                        if parsed.get("run_id"):
                            run._id = parsed["run_id"]
                        yield StartChunk(run_id=parsed.get("run_id") or "")
                    elif event_type == "text":
                        text = parsed.get("text") or ""
                        if text:
                            raw_output += text
                            yield TextDeltaChunk(text=text)
                    elif event_type == "thinking":
                        text = parsed.get("text") or ""
                        if text:
                            yield ReasoningChunk(text=text)
                    elif event_type == "tool":
                        tool_call_id = _resolve_tool_call_id(parsed)
                        if on_tool_use:
                            on_tool_use(
                                {
                                    "tool_call_id": tool_call_id,
                                    "name": parsed.get("name") or "",
                                    "input": parsed.get("input") or {},
                                }
                            )
                        yield ToolCallChunk(
                            tool_call_id=tool_call_id,
                            tool_name=parsed.get("name") or "",
                            input=parsed.get("input") or {},
                        )
                    elif event_type == "tool_result":
                        tool_call_id = _resolve_tool_call_id(parsed)
                        if on_tool_result:
                            on_tool_result(
                                {
                                    "tool_call_id": tool_call_id,
                                    "output": parsed.get("output"),
                                }
                            )
                        yield ToolResultChunk(
                            tool_call_id=tool_call_id, output=parsed.get("output")
                        )
                    elif event_type == "done":
                        run._input_tokens = parsed.get("input_tokens") or 0
                        run._output_tokens = parsed.get("output_tokens") or 0
                        run._cached_input_tokens = parsed.get("cached_input_tokens") or 0
                        run._total_usd = parsed.get("total_cost_usd") or 0
                        if parsed.get("output"):
                            raw_output = parsed["output"]
                        yield FinishChunk(
                            output=parsed.get("output") or "",
                            usage=FinishUsage(
                                input_tokens=parsed.get("input_tokens") or 0,
                                output_tokens=parsed.get("output_tokens") or 0,
                                cached_input_tokens=parsed.get("cached_input_tokens") or 0,
                            ),
                            session_id=parsed.get("session_id") or "",
                        )
                    elif event_type == "stats":
                        yield StatsChunk(
                            cpu_ns=parsed.get("cpu_ns") or 0,
                            memory_peak_bytes=parsed.get("memory_peak_bytes") or 0,
                        )
                    elif event_type == "error":
                        raise BoxError(parsed.get("error") or "Stream error")
                    else:
                        yield UnknownChunk(event=event_type, data=parsed)

                finished = True
                run._result = raw_output.strip()
                run._status = "completed"
                run._compute_ms = time.time() * 1000 - start
            except BoxError:
                run._result = raw_output.strip()
                run._status = "failed"
                run._compute_ms = time.time() * 1000 - start
                raise
            finally:
                response.close()
                if not finished and run._status == "running":
                    run._result = raw_output.strip()
                    run._status = "detached"
                    run._compute_ms = time.time() * 1000 - start

        run._iterator = iterate()
        return run

    def _build_run_stream_request(self, request_body, files, timeout) -> httpx.Request:
        mode, prepared, file_paths = common.prepare_run_request(request_body, files)
        url = f"{self._base_url}/v2/box/{self.id}/run/stream"
        return self._build_stream_request(url, mode, prepared, file_paths, timeout)

    def _build_stream_request(self, url, mode, prepared, file_paths, timeout) -> httpx.Request:
        headers = dict(self._headers)
        resolved_timeout = _ms_to_seconds(self._timeout_ms if timeout is None else timeout)
        kwargs: Dict[str, Any] = {"timeout": resolved_timeout}
        if mode == "multipart":
            kwargs["data"] = common.multipart_field_data(prepared)
            kwargs["files"] = _build_multipart_files(file_paths)
        else:
            headers["Content-Type"] = "application/json"
            kwargs["content"] = json.dumps(prepared)
        return self._client.build_request("POST", url, headers=headers, **kwargs)

    def _open_stream(self, request: httpx.Request) -> httpx.Response:
        response = self._client.send(request, stream=True)
        if not response.is_success:
            response.read()
            common.raise_for_status(response)
        return response

    def _post_run(self, url, mode, prepared, file_paths):
        headers = dict(self._headers)
        kwargs: Dict[str, Any] = {"timeout": _ms_to_seconds(self._timeout_ms)}
        if mode == "multipart":
            kwargs["data"] = common.multipart_field_data(prepared)
            kwargs["files"] = _build_multipart_files(file_paths)
        else:
            headers["Content-Type"] = "application/json"
            kwargs["content"] = json.dumps(prepared)
        return self._client.post(url, headers=headers, **kwargs)

    # ==================== Exec ====================

    def _exec_command(self, command: str) -> Run[str]:
        start = time.time() * 1000
        folder = self._get_folder()
        body: Dict[str, Any] = {"command": ["sh", "-c", command]}
        if folder:
            body["folder"] = folder
        result = self._request("POST", f"/v2/box/{self.id}/exec", body=body)
        run: Run[str] = Run(self, "command")
        run._result = result.get("error") or result.get("output") or ""
        run._status = "completed" if result.get("exit_code") == 0 else "failed"
        run._exit_code = result.get("exit_code")
        run._compute_ms = time.time() * 1000 - start
        return run

    def _exec_code(self, code, lang, timeout) -> Run[str]:
        start = time.time() * 1000
        folder = self._get_folder()
        body: Dict[str, Any] = {"code": code, "language": lang}
        if timeout is not None:
            body["timeout"] = timeout
        if folder:
            body["folder"] = folder
        result = self._request("POST", f"/v2/box/{self.id}/code", body=body)
        run: Run[str] = Run(self, "code")
        run._result = result.get("error") or result.get("output") or ""
        run._status = "completed" if result.get("exit_code") == 0 else "failed"
        run._exit_code = result.get("exit_code")
        run._compute_ms = time.time() * 1000 - start
        return run

    def _exec_stream(self, command: str) -> StreamRun[str]:
        folder = self._get_folder()
        body: Dict[str, Any] = {"command": ["sh", "-c", command]}
        if folder:
            body["folder"] = folder
        return self._exec_stream_request(f"/v2/box/{self.id}/exec-stream", body, "command")

    def _exec_stream_code(self, code, lang, timeout) -> StreamRun[str]:
        folder = self._get_folder()
        body: Dict[str, Any] = {"code": code, "language": lang}
        if timeout is not None:
            body["timeout"] = timeout
        if folder:
            body["folder"] = folder
        return self._exec_stream_request(f"/v2/box/{self.id}/code-stream", body, "code")

    def _exec_stream_request(self, path, body, type_) -> StreamRun[str]:
        start = time.time() * 1000
        run: StreamRun[str] = StreamRun(self, type_)
        box: "Box" = self
        url = f"{self._base_url}{path}"
        headers = dict(self._headers)
        headers["Content-Type"] = "application/json"
        request = self._client.build_request(
            "POST",
            url,
            headers=headers,
            content=json.dumps(body),
            timeout=_ms_to_seconds(self._timeout_ms),
        )

        def iterate() -> Iterator[ExecStreamChunk]:
            full_output = ""
            finished = False
            response = box._open_stream(request)
            try:
                for chunk in iter_exec_stream(response):
                    if isinstance(chunk, ExecOutputChunk):
                        full_output += chunk.data
                    elif isinstance(chunk, ExecExitChunk):
                        run._exit_code = chunk.exit_code
                        run._status = "completed" if chunk.exit_code == 0 else "failed"
                    yield chunk
                finished = True
                run._result = full_output
                run._compute_ms = time.time() * 1000 - start
                if run._status == "running":
                    run._status = "completed"
            except BoxError:
                run._result = full_output
                run._status = "failed"
                run._compute_ms = time.time() * 1000 - start
                raise
            finally:
                response.close()
                if not finished and run._status == "running":
                    run._result = full_output
                    run._status = "detached"
                    run._compute_ms = time.time() * 1000 - start

        run._iterator = iterate()
        return run

    # ==================== Working directory ====================

    def cd(self, path: str) -> None:
        if path.startswith("/"):
            new_path = _normalize_path(path)
        else:
            new_path = _normalize_path(f"{self._cwd}/{path}")
        result = self._request(
            "POST", f"/v2/box/{self.id}/exec", body={"command": ["ls", new_path]}
        )
        if result.get("exit_code") != 0:
            raise BoxError(f"cd: {path}: No such file or directory")
        self._cwd = new_path

    def _get_folder(self) -> str:
        prefix = WORKSPACE + "/"
        if self._cwd == WORKSPACE:
            return ""
        if self._cwd.startswith(prefix):
            return self._cwd[len(prefix) :]
        return self._cwd

    def _resolve_path(self, p: str) -> str:
        if p.startswith("/"):
            return p
        return f"{self._cwd}/{p}"

    # ==================== Files ====================

    def _read_file(self, path: str, encoding: Optional[str]) -> str:
        resolved = self._resolve_path(path)
        url = f"/v2/box/{self.id}/files/read?path={_q(resolved)}"
        if encoding:
            url += f"&encoding={_q(encoding)}"
        data = self._request("GET", url)
        return data.get("content", "")

    def _write_file(self, path, content, encoding) -> None:
        resolved = self._resolve_path(path)
        body: Dict[str, Any] = {"path": resolved, "content": content}
        if encoding:
            body["encoding"] = encoding
        self._request("POST", f"/v2/box/{self.id}/files/write", body=body)

    def _list_files(self, path: Optional[str]) -> List[FileEntry]:
        qs = ""
        if path:
            qs = f"?folder={_q(self._resolve_path(path))}"
        else:
            folder = self._get_folder()
            if folder:
                qs = f"?folder={_q(folder)}"
        data = self._request("GET", f"/v2/box/{self.id}/files/list{qs}")
        files = data.get("files") or []
        return [FileEntry.model_validate(f) for f in files]

    def _upload_files(self, files: List[UploadFileEntry]) -> None:
        upload_files = []
        data_paths = []
        for f in files:
            resolved = self._resolve_path(f["destination"])
            with open(f["path"], "rb") as fh:
                content = fh.read()
            data_paths.append(resolved)
            upload_files.append(("files", (f["destination"], content)))
        url = f"{self._base_url}/v2/box/{self.id}/files/upload"
        self._log("POST", url)
        response = self._client.post(
            url,
            headers=self._headers,
            data={"paths": data_paths},
            files=upload_files,
            timeout=_ms_to_seconds(self._timeout_ms),
        )
        common.raise_for_status(response)

    def _download_files(self, remote_path: Optional[str]) -> None:
        resolved = self._resolve_path(remote_path) if remote_path else self._cwd
        if remote_path:
            dest = f"./{os.path.basename(resolved)}"
        elif self._cwd == WORKSPACE:
            dest = "./workspace"
        else:
            dest = f"./{os.path.basename(self._cwd)}"

        files = self._list_files(resolved)
        os.makedirs(dest, exist_ok=True)
        for f in files:
            if f.is_dir:
                continue
            url = f"{self._base_url}/v2/box/{self.id}/files/download?folder={_q(f.path)}"
            response = self._client.get(
                url, headers=self._headers, timeout=_ms_to_seconds(self._timeout_ms)
            )
            if not response.is_success:
                raise BoxError(f"Failed to download {f.path}", response.status_code)
            # Sanitize the remote-provided name: never let it escape `dest` via
            # path separators or absolute paths (path-traversal hardening).
            safe_name = os.path.basename(f.name)
            if not safe_name or safe_name in (".", ".."):
                raise BoxError(f"Unsafe download filename: {f.name!r}")
            with open(os.path.join(dest, safe_name), "wb") as fh:
                fh.write(response.content)

    # ==================== Lifecycle ====================

    def get_status(self) -> Dict[str, Any]:
        return self._request("GET", f"/v2/box/{self.id}/status")

    def configure_model(self, model: str) -> None:
        self._request("PUT", f"/v2/box/{self.id}/config/model", body={"model": model})
        self._model = model
        self._is_agent_configured = True

    def configure_custom_harness(self, custom_harness: CustomHarnessConfig) -> None:

        if self._agent != Agent.CUSTOM.value:
            raise BoxError("Custom harness can only be configured on custom agent boxes")
        self._request(
            "PUT",
            f"/v2/box/{self.id}/config/custom-runner",
            body={"custom_runner": custom_harness},
        )
        self._is_agent_configured = True

    def update_network_policy(self, policy: NetworkPolicy) -> None:
        self._request(
            "PUT",
            f"/v2/box/{self.id}/config/network-policy",
            body=common.serialize_network_policy(policy),
        )
        self._network_policy = policy

    def get_init_command(self) -> str:
        self._require_keep_alive("Init command")
        data = self._request("GET", f"/v2/box/{self.id}/startup")
        return data.get("init_command", "")

    def set_init_command(self, init_command: str) -> None:
        self._require_keep_alive("Init command")
        if not init_command:
            raise BoxError("init_command is required")
        self._request("PUT", f"/v2/box/{self.id}/startup", body={"init_command": init_command})

    def delete_init_command(self) -> None:
        self._require_keep_alive("Init command")
        self._request("DELETE", f"/v2/box/{self.id}/startup")

    def pause(self) -> None:
        if self.keep_alive:
            raise BoxError("Keep-alive boxes cannot be paused")
        self._request("POST", f"/v2/box/{self.id}/pause")

    def resume(self) -> None:
        self._request("POST", f"/v2/box/{self.id}/resume")

    def delete(self) -> None:
        self._request("DELETE", f"/v2/box/{self.id}")
        self.close()

    def snapshot(self, *, name: str) -> Snapshot:
        data = self._request("POST", f"/v2/box/{self.id}/snapshots", body={"name": name})
        snapshot = Snapshot.model_validate(data)
        start = time.time()
        while snapshot.status == "creating" and time.time() - start < 300:
            time.sleep(2)
            snapshots = self.list_snapshots()
            for s in snapshots:
                if s.id == snapshot.id:
                    snapshot = s
        if snapshot.status == "creating":
            raise BoxError("Snapshot creation timed out")
        if snapshot.status == "error":
            raise BoxError("Snapshot creation failed")
        return snapshot

    def list_snapshots(self) -> List[Snapshot]:
        data = self._request("GET", f"/v2/box/{self.id}/snapshots")
        return [Snapshot.model_validate(s) for s in (data.get("snapshots") or [])]

    def delete_snapshot(self, snapshot_id: str) -> None:
        self._request("DELETE", f"/v2/box/{self.id}/snapshots/{snapshot_id}")

    def logs(self, *, offset: Optional[int] = None, limit: Optional[int] = None) -> List[LogEntry]:
        params = []
        if offset is not None:
            params.append(f"offset={offset}")
        if limit is not None:
            params.append(f"limit={limit}")
        qs = ("?" + "&".join(params)) if params else ""
        data = self._request("GET", f"/v2/box/{self.id}/logs{qs}")
        return [LogEntry.model_validate(entry) for entry in data.get("logs", [])]

    def list_runs(self) -> List[BoxRunData]:

        data = self._request("GET", f"/v2/box/{self.id}/runs")
        return [BoxRunData.model_validate(r) for r in data.get("runs", [])]

    # ==================== Schedules ====================

    def _schedule_exec(self, options: Dict[str, Any]) -> Schedule:
        body: Dict[str, Any] = {
            "type": "exec",
            "cron": options["cron"],
            "command": options["command"],
            "folder": self._resolve_path(options["folder"]) if options.get("folder") else self._cwd,
        }
        if options.get("webhook_url"):
            body["webhook_url"] = options["webhook_url"]
        if options.get("webhook_headers"):
            body["webhook_headers"] = options["webhook_headers"]
        data = self._request("POST", f"/v2/box/{self.id}/schedules", body=body)
        return Schedule.model_validate(data)

    def _schedule_agent(self, options: Dict[str, Any]) -> Schedule:
        body: Dict[str, Any] = {
            "type": "prompt",
            "cron": options["cron"],
            "prompt": options["prompt"],
            "folder": self._resolve_path(options["folder"]) if options.get("folder") else self._cwd,
        }
        if options.get("model"):
            body["model"] = options["model"]
        if options.get("options"):
            body["agent_options"] = common.to_backend_agent_options(self._agent, options["options"])
        if options.get("timeout") is not None:
            body["timeout"] = options["timeout"]
        if options.get("webhook_url"):
            body["webhook_url"] = options["webhook_url"]
        if options.get("webhook_headers"):
            body["webhook_headers"] = options["webhook_headers"]
        data = self._request("POST", f"/v2/box/{self.id}/schedules", body=body)
        return Schedule.model_validate(data)

    def _schedule_list(self) -> List[Schedule]:
        data = self._request("GET", f"/v2/box/{self.id}/schedules")
        return [Schedule.model_validate(s) for s in data]

    def _schedule_get(self, id: str) -> Schedule:
        data = self._request("GET", f"/v2/box/{self.id}/schedules/{id}")
        return Schedule.model_validate(data)

    def _schedule_pause(self, id: str) -> None:
        self._request("POST", f"/v2/box/{self.id}/schedules/{id}/pause")

    def _schedule_resume(self, id: str) -> None:
        self._request("POST", f"/v2/box/{self.id}/schedules/{id}/resume")

    def _schedule_delete(self, id: str) -> None:
        self._request("DELETE", f"/v2/box/{self.id}/schedules/{id}")

    # ==================== Git ====================

    def _git_clone(self, repo, branch) -> None:
        folder = self._get_folder()
        body: Dict[str, Any] = {"repo": repo, "branch": branch, "github_token": self._git_token}
        if folder:
            body["folder"] = folder
        self._request("POST", f"/v2/box/{self.id}/git/clone", body=body)

    def _git_diff(self) -> str:
        folder = self._get_folder()
        qs = f"?folder={_q(folder)}" if folder else ""
        data = self._request("GET", f"/v2/box/{self.id}/git/diff{qs}")
        return data.get("diff", "")

    def _git_status(self) -> str:
        folder = self._get_folder()
        qs = f"?folder={_q(folder)}" if folder else ""
        data = self._request("GET", f"/v2/box/{self.id}/git/status{qs}")
        return data.get("status", "")

    def _git_commit(self, message, author_name, author_email) -> GitCommitResult:
        folder = self._get_folder()
        body: Dict[str, Any] = {
            "message": message,
            "author_name": author_name,
            "author_email": author_email,
        }
        if folder:
            body["folder"] = folder
        data = self._request("POST", f"/v2/box/{self.id}/git/commit", body=body)
        return GitCommitResult.model_validate(data)

    def _git_update_config(self, user_name, user_email) -> GitConfigResult:
        if not user_name and not user_email:
            raise BoxError("At least one of user_name or user_email is required")
        data = self._request(
            "PUT",
            f"/v2/box/{self.id}/git-config",
            body={"git_user_name": user_name, "git_user_email": user_email},
        )
        return GitConfigResult.model_validate(data)

    def _git_push(self, branch) -> None:
        folder = self._get_folder()
        body: Dict[str, Any] = {"branch": branch}
        if folder:
            body["folder"] = folder
        self._request("POST", f"/v2/box/{self.id}/git/push", body=body)

    def _git_create_pr(self, title, body_text, base) -> PullRequest:
        folder = self._get_folder()
        body: Dict[str, Any] = {"title": title, "body": body_text, "base": base}
        if folder:
            body["folder"] = folder
        data = self._request("POST", f"/v2/box/{self.id}/git/create-pr", body=body)
        return PullRequest.model_validate(data)

    def _git_exec(self, args) -> str:
        folder = self._get_folder()
        body: Dict[str, Any] = {"args": args}
        if folder:
            body["folder"] = folder
        data = self._request("POST", f"/v2/box/{self.id}/git/exec", body=body)
        return data.get("output", "")

    def _git_checkout(self, branch) -> None:
        folder = self._get_folder()
        body: Dict[str, Any] = {"branch": branch}
        if folder:
            body["folder"] = folder
        self._request("POST", f"/v2/box/{self.id}/git/checkout", body=body)

    # ==================== Skills ====================

    def _skill_add(self, skill_id: str) -> None:
        self._request("POST", f"/v2/box/{self.id}/config/skills", body={"skill_id": skill_id})

    def _skill_remove(self, skill_id: str) -> None:
        self._request("DELETE", f"/v2/box/{self.id}/config/skills/{skill_id}")

    def _skill_list(self) -> List[str]:
        data = self._request("GET", f"/v2/box/{self.id}")
        return data.get("enabled_skills") or []

    def _label_add(self, label: str) -> List[str]:
        data = self._request("POST", f"/v2/box/{self.id}/config/labels", body={"label": label})
        return (data or {}).get("labels") or []

    def _label_remove(self, label: str) -> List[str]:
        data = self._request("DELETE", f"/v2/box/{self.id}/config/labels/{_q(label)}")
        return (data or {}).get("labels") or []

    def _label_list(self) -> List[str]:
        data = self._request("GET", f"/v2/box/{self.id}")
        return data.get("labels") or []

    # ==================== Public URLs ====================

    def get_public_url(
        self, port: int, *, bearer_token: Optional[bool] = None, basic_auth: Optional[bool] = None
    ) -> PublicURL:
        body: Dict[str, Any] = {"port": port}
        if bearer_token is not None:
            body["bearer_token"] = bearer_token
        if basic_auth is not None:
            body["basic_auth"] = basic_auth
        data = self._request("POST", f"/v2/box/{self.id}/preview", body=body)
        return PublicURL.model_validate(data)

    def list_public_urls(self) -> Dict[str, List[PublicURL]]:
        data = self._request("GET", f"/v2/box/{self.id}/preview")
        return {"public_urls": [PublicURL.model_validate(p) for p in data.get("previews", [])]}

    def delete_public_url(self, port: int) -> None:
        self._request("DELETE", f"/v2/box/{self.id}/preview/{port}")

    # ==================== Static methods ====================

    @classmethod
    def create(cls, **config: Unpack[BoxConfig]) -> "Box":
        api_key = common.resolve_api_key(config.get("api_key"))
        agent = config.get("agent")
        if agent:
            common.resolve_agent_model(agent)
        if config.get("init_command") is not None and not config.get("keep_alive"):
            raise BoxError("init_command requires keep_alive=True")
        base_url = common.resolve_base_url(config.get("base_url"))
        headers = common.build_headers(api_key)
        timeout = config.get("timeout", _DEFAULT_TIMEOUT_MS)
        debug = config.get("debug", False)

        body = _build_create_body(config, agent)
        client = httpx.Client()
        try:
            response = client.post(
                f"{base_url}/v2/box",
                headers={**headers, "Content-Type": "application/json"},
                content=json.dumps(body),
                timeout=_ms_to_seconds(timeout),
            )
            common.raise_for_status(response)
            data = response.json()

            start = time.time()
            while data.get("status") == "creating" and time.time() - start < 300:
                time.sleep(2)
                poll = client.get(
                    f"{base_url}/v2/box/{data['id']}",
                    headers=headers,
                    timeout=_ms_to_seconds(timeout),
                )
                if poll.is_success:
                    data = poll.json()

            if data.get("status") == "creating":
                raise BoxError("Box creation timed out")
            if data.get("status") == "error":
                raise BoxError("Box creation failed")
        except BaseException:
            client.close()
            raise

        return cls(
            data,
            {
                "base_url": base_url,
                "headers": headers,
                "timeout": timeout,
                "debug": debug,
                "git_token": (config.get("git") or {}).get("token"),
                "is_agent_configured": bool(data.get("agent")),
                "client": client,
            },
        )

    @classmethod
    def get(cls, box_id: str, **options: Unpack[BoxGetOptions]) -> "Box":
        api_key = common.resolve_api_key(options.get("api_key"))
        base_url = common.resolve_base_url(options.get("base_url"))
        headers = common.build_headers(api_key)
        timeout = options.get("timeout", _DEFAULT_TIMEOUT_MS)
        debug = options.get("debug", False)
        client = httpx.Client()
        try:
            response = client.get(
                f"{base_url}/v2/box/{box_id}",
                headers=headers,
                timeout=_ms_to_seconds(timeout),
            )
            common.raise_for_status(response)
            data = response.json()
        except BaseException:
            client.close()
            raise
        return cls(
            data,
            {
                "base_url": base_url,
                "headers": headers,
                "timeout": timeout,
                "debug": debug,
                "git_token": options.get("git_token"),
                "is_agent_configured": bool(data.get("model")),
                "client": client,
            },
        )

    @classmethod
    def get_by_name(cls, name: str, **options: Unpack[BoxGetOptions]) -> "Box":
        return cls.get(name, **options)

    @classmethod
    def list(cls, **options: Unpack[ListOptions]) -> List[BoxData]:

        api_key = common.resolve_api_key(options.get("api_key"))
        base_url = common.resolve_base_url(options.get("base_url"))
        headers = common.build_headers(api_key)
        label = options.get("label")
        query = f"?label={_q(label)}" if label else ""
        with httpx.Client() as client:
            response = client.get(f"{base_url}/v2/box{query}", headers=headers)
            common.raise_for_status(response)
            return [BoxData.model_validate(b) for b in response.json()]

    @classmethod
    def from_snapshot(cls, snapshot_id: str, **config: Unpack[BoxConfig]) -> "Box":
        api_key = common.resolve_api_key(config.get("api_key"))
        base_url = common.resolve_base_url(config.get("base_url"))
        headers = common.build_headers(api_key)
        timeout = config.get("timeout", _DEFAULT_TIMEOUT_MS)
        debug = config.get("debug", False)
        agent = config.get("agent")

        body = _build_create_body(config, agent)
        body["snapshot_id"] = snapshot_id
        client = httpx.Client()
        try:
            response = client.post(
                f"{base_url}/v2/box/from-snapshot",
                headers={**headers, "Content-Type": "application/json"},
                content=json.dumps(body),
                timeout=_ms_to_seconds(timeout),
            )
            common.raise_for_status(response)
            data = response.json()

            start = time.time()
            while data.get("status") == "creating" and time.time() - start < 300:
                time.sleep(2)
                poll = client.get(
                    f"{base_url}/v2/box/{data['id']}",
                    headers=headers,
                    timeout=_ms_to_seconds(timeout),
                )
                if poll.is_success:
                    data = poll.json()

            if data.get("status") == "creating":
                raise BoxError("Box creation from snapshot timed out")
            if data.get("status") == "error":
                raise BoxError("Box creation from snapshot failed")
        except BaseException:
            client.close()
            raise

        return cls(
            data,
            {
                "base_url": base_url,
                "headers": headers,
                "timeout": timeout,
                "debug": debug,
                "git_token": (config.get("git") or {}).get("token"),
                "is_agent_configured": bool(data.get("model")),
                "client": client,
            },
        )

    @classmethod
    def delete_boxes(
        cls, *, box_ids: Union[str, List[str]], **options: Unpack[BoxConnectionOptions]
    ) -> None:
        api_key = common.resolve_api_key(options.get("api_key"))
        base_url = common.resolve_base_url(options.get("base_url"))
        headers = common.build_headers(api_key)
        ids = box_ids if isinstance(box_ids, list) else [box_ids]
        with httpx.Client() as client:
            response = client.request(
                "DELETE",
                f"{base_url}/v2/box",
                headers={**headers, "Content-Type": "application/json"},
                content=json.dumps({"ids": ids}),
            )
            common.raise_for_status(response)

    @classmethod
    def delete_snapshots(
        cls,
        *,
        snapshot_ids: Optional[Union[str, List[str]]] = None,
        **options: Unpack[BoxConnectionOptions],
    ) -> Dict[str, Any]:
        api_key = common.resolve_api_key(options.get("api_key"))
        base_url = common.resolve_base_url(options.get("base_url"))
        headers = common.build_headers(api_key)
        body: Dict[str, Any] = {}
        if snapshot_ids is not None:
            body["ids"] = snapshot_ids if isinstance(snapshot_ids, list) else [snapshot_ids]
        with httpx.Client() as client:
            response = client.request(
                "DELETE",
                f"{base_url}/v2/box/snapshots",
                headers={**headers, "Content-Type": "application/json"},
                content=json.dumps(body),
            )
            common.raise_for_status(response)
            return response.json()

    @classmethod
    def set_env(cls, key: str, value: str, **options: Unpack[BoxConnectionOptions]) -> None:
        api_key = common.resolve_api_key(options.get("api_key"))
        base_url = common.resolve_base_url(options.get("base_url"))
        headers = common.build_headers(api_key)
        with httpx.Client() as client:
            response = client.put(
                f"{base_url}/v2/box/settings/env/{_q(key)}",
                headers={**headers, "Content-Type": "application/json"},
                content=json.dumps({"value": value}),
            )
            common.raise_for_status(response)

    @classmethod
    def list_env(cls, **options: Unpack[BoxConnectionOptions]) -> Dict[str, str]:
        api_key = common.resolve_api_key(options.get("api_key"))
        base_url = common.resolve_base_url(options.get("base_url"))
        headers = common.build_headers(api_key)
        with httpx.Client() as client:
            response = client.get(f"{base_url}/v2/box/settings/env", headers=headers)
            common.raise_for_status(response)
            data = response.json()
            return data.get("env_vars", data)

    @classmethod
    def delete_env(cls, key: str, **options: Unpack[BoxConnectionOptions]) -> None:
        api_key = common.resolve_api_key(options.get("api_key"))
        base_url = common.resolve_base_url(options.get("base_url"))
        headers = common.build_headers(api_key)
        with httpx.Client() as client:
            response = client.delete(f"{base_url}/v2/box/settings/env/{_q(key)}", headers=headers)
            common.raise_for_status(response)

    @classmethod
    def set_all_env(cls, vars: Dict[str, str], **options: Unpack[BoxConnectionOptions]) -> None:
        api_key = common.resolve_api_key(options.get("api_key"))
        base_url = common.resolve_base_url(options.get("base_url"))
        headers = common.build_headers(api_key)
        with httpx.Client() as client:
            response = client.put(
                f"{base_url}/v2/box/settings/env",
                headers={**headers, "Content-Type": "application/json"},
                content=json.dumps({"env_vars": vars}),
            )
            common.raise_for_status(response)


class EphemeralBox:
    """A lightweight, short-lived box supporting exec, files, and schedules only."""

    def __init__(self, box: Box, expires_at: int) -> None:
        self._box = box
        self.id = box.id
        self.expires_at = expires_at
        self.exec = box.exec
        self.files = box.files
        self.schedule = box.schedule

    @property
    def cwd(self) -> str:
        return self._box.cwd

    @property
    def network_policy(self) -> NetworkPolicy:
        return self._box.network_policy

    def cd(self, path: str) -> None:
        self._box.cd(path)

    def get_status(self) -> Dict[str, Any]:
        return self._box.get_status()

    def delete(self) -> None:
        self._box.delete()

    def close(self) -> None:
        self._box.close()

    def __enter__(self) -> "EphemeralBox":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def snapshot(self, *, name: str) -> Snapshot:
        return self._box.snapshot(name=name)

    def list_snapshots(self) -> List[Snapshot]:
        return self._box.list_snapshots()

    def delete_snapshot(self, snapshot_id: str) -> None:
        self._box.delete_snapshot(snapshot_id)

    @classmethod
    def create(cls, **config: Unpack[EphemeralBoxConfig]) -> "EphemeralBox":
        api_key = common.resolve_api_key(config.get("api_key"))
        base_url = common.resolve_base_url(config.get("base_url"))
        headers = common.build_headers(api_key)
        timeout = config.get("timeout", _DEFAULT_TIMEOUT_MS)
        debug = config.get("debug", False)
        body = _build_ephemeral_body(config)
        client = httpx.Client()
        try:
            response = client.post(
                f"{base_url}/v2/box",
                headers={**headers, "Content-Type": "application/json"},
                content=json.dumps(body),
                timeout=_ms_to_seconds(timeout),
            )
            common.raise_for_status(response)
            data = response.json()
        except BaseException:
            client.close()
            raise
        box: Box = Box(
            data,
            {
                "base_url": base_url,
                "headers": headers,
                "timeout": timeout,
                "debug": debug,
                "client": client,
            },
        )
        return cls(box, data.get("expires_at", 0))

    @classmethod
    def from_snapshot(
        cls, snapshot_id: str, **config: Unpack[EphemeralBoxConfig]
    ) -> "EphemeralBox":
        api_key = common.resolve_api_key(config.get("api_key"))
        base_url = common.resolve_base_url(config.get("base_url"))
        headers = common.build_headers(api_key)
        timeout = config.get("timeout", _DEFAULT_TIMEOUT_MS)
        debug = config.get("debug", False)
        body = _build_ephemeral_body(config)
        body["snapshot_id"] = snapshot_id
        client = httpx.Client()
        try:
            response = client.post(
                f"{base_url}/v2/box/from-snapshot",
                headers={**headers, "Content-Type": "application/json"},
                content=json.dumps(body),
                timeout=_ms_to_seconds(timeout),
            )
            common.raise_for_status(response)
            data = response.json()
        except BaseException:
            client.close()
            raise
        box: Box = Box(
            data,
            {
                "base_url": base_url,
                "headers": headers,
                "timeout": timeout,
                "debug": debug,
                "client": client,
            },
        )
        return cls(box, data.get("expires_at", 0))

    @classmethod
    def get_by_name(cls, name: str, **options: Unpack[BoxGetOptions]) -> Box:
        # Mirrors JS: EphemeralBox.getByName = Box.get -> returns a Box, not Ephemeral.
        return Box.get(name, **options)

    @classmethod
    def delete_boxes(
        cls, *, box_ids: Union[str, List[str]], **options: Unpack[BoxConnectionOptions]
    ) -> None:
        Box.delete_boxes(box_ids=box_ids, **options)

    @classmethod
    def delete_snapshots(
        cls,
        *,
        snapshot_ids: Optional[Union[str, List[str]]] = None,
        **options: Unpack[BoxConnectionOptions],
    ) -> Dict[str, Any]:
        return Box.delete_snapshots(snapshot_ids=snapshot_ids, **options)


# ==================== Module helpers ====================


def _ms_to_seconds(ms: Optional[float]) -> Optional[float]:
    if ms is None:
        return None
    return ms / 1000.0


def _q(value: str) -> str:
    from urllib.parse import quote

    return quote(value, safe="")


def _safe_json(data: str) -> Optional[Dict[str, Any]]:
    try:
        parsed = json.loads(data)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return None


def _build_multipart_files(file_paths: List[str]) -> List[Any]:
    out = []
    for path in file_paths:
        with open(path, "rb") as fh:
            content = fh.read()
        out.append(("files", (os.path.basename(path), content, common.mime_for_path(path))))
    return out


def _build_create_body(
    config: Mapping[str, Any], agent: Optional[Mapping[str, Any]]
) -> Dict[str, Any]:
    body: Dict[str, Any] = {}
    if config.get("name"):
        body["name"] = config["name"]
    if config.get("labels"):
        body["labels"] = config["labels"]
    if config.get("size"):
        body["size"] = config["size"]
    if config.get("keep_alive"):
        body["keep_alive"] = True
    if config.get("init_command") is not None:
        body["init_command"] = config["init_command"]
    if agent:
        common.append_agent_config_to_body(body, agent)
    if config.get("runtime"):
        body["runtime"] = config["runtime"]
    git = config.get("git") or {}
    if git.get("token"):
        body["github_token"] = git["token"]
    if git.get("user_name"):
        body["git_user_name"] = git["user_name"]
    if git.get("user_email"):
        body["git_user_email"] = git["user_email"]
    if config.get("env"):
        body["env_vars"] = config["env"]
    if config.get("attach_headers"):
        body["attach_headers"] = config["attach_headers"]
    if config.get("network_policy"):
        body["network_policy"] = common.serialize_network_policy(config["network_policy"])
    if config.get("skills"):
        body["skills"] = config["skills"]
    if config.get("mcp_servers"):
        body["mcp_servers"] = common.serialize_mcp_servers(config["mcp_servers"])
    return body


def _build_ephemeral_body(config: Mapping[str, Any]) -> Dict[str, Any]:
    body: Dict[str, Any] = {"ephemeral": True}
    if config.get("name"):
        body["name"] = config["name"]
    if config.get("labels"):
        body["labels"] = config["labels"]
    if config.get("size"):
        body["size"] = config["size"]
    if config.get("ttl") is not None:
        body["ttl"] = config["ttl"]
    if config.get("runtime"):
        body["runtime"] = config["runtime"]
    if config.get("env"):
        body["env_vars"] = config["env"]
    if config.get("attach_headers"):
        body["attach_headers"] = config["attach_headers"]
    if config.get("network_policy"):
        body["network_policy"] = common.serialize_network_policy(config["network_policy"])
    return body
