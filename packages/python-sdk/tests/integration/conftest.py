"""Integration-only conftest. Loads a `.env` (if present) so a real
UPSTASH_BOX_API_KEY enables the suite, provides an `opts` fixture, and skips all
integration tests when no key is set. Applies ONLY to tests/integration/.
"""

import os

import pytest

try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:  # pragma: no cover - optional dependency
    pass

API_KEY = os.environ.get("UPSTASH_BOX_API_KEY")
BASE_URL = os.environ.get("UPSTASH_BOX_BASE_URL")


def pytest_collection_modifyitems(config, items):
    if API_KEY:
        return
    skip = pytest.mark.skip(reason="UPSTASH_BOX_API_KEY not set")
    for item in items:
        if "integration" in item.keywords:
            item.add_marker(skip)


@pytest.fixture
def opts() -> dict:
    kwargs = {"api_key": API_KEY}
    if BASE_URL:
        kwargs["base_url"] = BASE_URL
    return kwargs
