#!/usr/bin/env python3
"""Generate the synchronous client from the async source of truth.

The async client under ``upstash_box/_async/`` is the single place we edit.
This script uses ``unasync`` to produce ``upstash_box/_sync/`` by stripping
``await`` / ``async`` and renaming the async-specific symbols. Only client code
is generated — tests are handwritten (see CONTRIBUTING.md).

Usage (from anywhere):
    python scripts/generate_sync.py

CI asserts the result is up to date with:
    git diff --exit-code -- packages/python-sdk/upstash_box/_sync
"""

from __future__ import annotations

import pathlib
import re
import sys

import unasync

PACKAGE_ROOT = pathlib.Path(__file__).resolve().parent.parent
ASYNC_DIR = PACKAGE_ROOT / "upstash_box" / "_async"
SYNC_DIR = PACKAGE_ROOT / "upstash_box" / "_sync"

_BANNER = (
    "# DO NOT EDIT — generated from upstash_box/_async/ by scripts/generate_sync.py.\n"
    "# Edit the async source and re-run the generator. Hand-written sync code that\n"
    "# can't be generated cleanly belongs in upstash_box/_sync/_fallbacks.py.\n"
)

# The async source docstrings ("...SOURCE OF TRUTH", "use aiter_bytes...") are
# misleading once copied into the generated sync files (and get mangled by token
# substitution), so replace the leading module docstring with a neutral note.
_MODULE_DOCSTRING_RE = re.compile(r'\A"""[\s\S]*?"""')
_GENERATED_DOCSTRING = (
    '"""Generated synchronous client — DO NOT EDIT.\n\n'
    "Produced from upstash_box/_async/ by scripts/generate_sync.py. Edit the async\n"
    'source and re-run the generator."""'
)

_RULES = [
    unasync.Rule(
        fromdir="/upstash_box/_async/",
        todir="/upstash_box/_sync/",
        additional_replacements={
            "AsyncBox": "Box",
            "AsyncEphemeralBox": "EphemeralBox",
            "AsyncRun": "Run",
            "AsyncStreamRun": "StreamRun",
            "AsyncAgentNamespace": "AgentNamespace",
            "AsyncExecNamespace": "ExecNamespace",
            "AsyncFilesNamespace": "FilesNamespace",
            "AsyncGitNamespace": "GitNamespace",
            "AsyncScheduleNamespace": "ScheduleNamespace",
            "AsyncSkillsNamespace": "SkillsNamespace",
            "AsyncClient": "Client",
            "AsyncIterator": "Iterator",
            "aiter_bytes": "iter_bytes",
            "aclose": "close",
            "aread": "read",
            "__aenter__": "__enter__",
            "__aexit__": "__exit__",
            "__aiter__": "__iter__",
            "__anext__": "__next__",
            "asyncio": "time",
            "_async": "_sync",
        },
    )
]


def _dedupe_imports(text: str) -> str:
    """Drop duplicate top-level ``import X`` lines (the asyncio->time rename can
    produce a second ``import time``)."""
    seen: set[str] = set()
    out = []
    for line in text.splitlines(keepends=True):
        stripped = line.strip()
        if stripped.startswith("import ") and " " not in stripped[len("import ") :].strip():
            if stripped in seen:
                continue
            seen.add(stripped)
        out.append(line)
    return "".join(out)


def _postprocess(path: pathlib.Path) -> None:
    text = path.read_text()
    # Replace the leading (copied async) module docstring, if any.
    text = _MODULE_DOCSTRING_RE.sub(lambda _: _GENERATED_DOCSTRING, text, count=1)
    text = _dedupe_imports(text)
    if not text.startswith("# DO NOT EDIT"):
        text = _BANNER + text
    path.write_text(text)


def main() -> int:
    SYNC_DIR.mkdir(parents=True, exist_ok=True)
    files = [str(p) for p in ASYNC_DIR.glob("*.py")]
    unasync.unasync_files(files, _RULES)

    for generated in SYNC_DIR.glob("*.py"):
        if generated.name == "_fallbacks.py":
            continue
        _postprocess(generated)

    # Format generated files so `ruff format --check` and the diff-determinism
    # check stay stable (formatting is part of generation). Invoke ruff via the
    # current interpreter so it works regardless of PATH.
    import subprocess

    try:
        subprocess.run(
            [sys.executable, "-m", "ruff", "check", "--quiet", "--fix-only", str(SYNC_DIR)],
            check=False,
        )
        subprocess.run(
            [sys.executable, "-m", "ruff", "format", "--quiet", str(SYNC_DIR)],
            check=False,
        )
    except FileNotFoundError:
        print("warning: ruff not available; generated files were not auto-formatted")

    print("Generated sync client at:", SYNC_DIR)
    print("Verify up-to-date with:")
    print(
        "  python scripts/generate_sync.py && "
        "git diff --exit-code -- packages/python-sdk/upstash_box/_sync"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
