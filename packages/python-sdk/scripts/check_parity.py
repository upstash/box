#!/usr/bin/env python3
"""Enforce public-surface parity between the JS SDK (@upstash/box) and this
Python SDK. Run in CI — a JS public symbol with no Python counterpart (and not
listed as an intentional exception) is a HARD FAILURE.

JS surface is extracted via the TypeScript compiler (scripts/extract_js_surface.mjs,
needs Node). Python surface is introspected from the package. v1 compares at the
symbol-name level (camelCase <-> snake_case normalized); signature comparison is
a tracked follow-up.
"""

from __future__ import annotations

import json
import pathlib
import re
import subprocess
import sys

import upstash_box
from upstash_box import AsyncBox, AsyncEphemeralBox

PACKAGE_ROOT = pathlib.Path(__file__).resolve().parent.parent
EXTRACTOR = PACKAGE_ROOT / "scripts" / "extract_js_surface.mjs"

# --- Intentional exceptions (tracked drift) -------------------------------

# JS public symbols intentionally NOT ported (deprecated surface). Their
# absence in Python is by design — see PARITY.md.
JS_NOT_PORTED = {
    "inferDefaultRunner",  # deprecated alias of inferDefaultProvider
    "getPreviewUrl",  # deprecated -> getPublicURL
    "listPreviews",  # deprecated -> listPublicURLs
    "deletePreview",  # deprecated -> deletePublicURL
}

# (Python-only additions like close/aclose need no entry here: the check is
# one-directional JS->Python, so extra Python symbols don't fail it. They're
# documented in PARITY.md's exceptions table.)

# Renamed members: a JS symbol whose Python counterpart has a different name AND
# coexists with a same-named Python member (so the plain mapping can't guard it).
# JS static bulk `delete` -> Python `delete_boxes` (instance `delete` also exists,
# so without this the rename would pass even if delete_boxes were removed).
RENAMED_REQUIRED = {
    "Box": {"delete_boxes"},
    "EphemeralBox": {"delete_boxes"},
}

# Explicit name mappings where mechanical snake_case conversion is wrong
# (acronyms, etc.).
EXPLICIT = {
    "getPublicURL": "get_public_url",
    "listPublicURLs": "list_public_urls",
    "deletePublicURL": "delete_public_url",
}


def to_snake(name: str) -> str:
    if name in EXPLICIT:
        return EXPLICIT[name]
    s1 = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", name)
    s2 = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s1)
    return s2.lower()


def js_surface() -> dict:
    result = subprocess.run(["node", str(EXTRACTOR)], capture_output=True, text=True, check=True)
    return json.loads(result.stdout)


def py_members(instance: object) -> set:
    return {name for name in dir(instance) if not name.startswith("_")}


def _dummy_async_box() -> AsyncBox:
    # Introspection only (we read dir(box) — no requests), so we don't create a
    # real httpx client; that would leak an unclosed connection pool in CI.
    data = {"id": "x", "status": "idle", "created_at": 0, "updated_at": 0}
    config = {"base_url": "https://example.com", "headers": {}, "client": None}
    return AsyncBox(data, config)


def main() -> int:
    js = js_surface()
    errors: list[str] = []

    # 1. Module-level exports.
    py_exports = set(upstash_box.__all__)
    for name in js["exports"]:
        if name in JS_NOT_PORTED:
            continue
        if to_snake(name) not in {to_snake(x) for x in py_exports} and name not in py_exports:
            errors.append(f"export `{name}` (JS) has no Python counterpart")

    # 2. Box / EphemeralBox members.
    box = _dummy_async_box()
    ephemeral = AsyncEphemeralBox(box, 0)
    py_box = py_members(box)
    py_ephemeral = py_members(ephemeral)

    for cls_name, py_set in (("Box", py_box), ("EphemeralBox", py_ephemeral)):
        for name in js[cls_name]:
            if name in JS_NOT_PORTED:
                continue
            if to_snake(name) not in py_set:
                errors.append(f"{cls_name}.{name} (JS) -> `{to_snake(name)}` missing in Python")
        # Guard renamed members whose JS name collides with a same-named Python
        # member (e.g. JS bulk `delete` -> Python `delete_boxes`).
        for required in RENAMED_REQUIRED.get(cls_name, set()):
            if required not in py_set:
                errors.append(f"{cls_name}: renamed member `{required}` missing in Python")

    if errors:
        print("PARITY DRIFT DETECTED:\n")
        for e in errors:
            print(f"  - {e}")
        print(
            "\nAdd the Python equivalent, or record the symbol in PARITY.md and the "
            "JS_NOT_PORTED set in scripts/check_parity.py if the divergence is intentional."
        )
        return 1

    print("Parity OK: every JS public symbol has a Python counterpart.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
