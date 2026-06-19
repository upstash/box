"""Team-level env var management (static methods). Uses a unique key and cleans
up after itself so it doesn't disturb real settings."""

import uuid

import pytest

from upstash_box import AsyncBox

pytestmark = pytest.mark.integration


async def test_env_set_list_delete(opts):
    key = f"PY_SDK_IT_{uuid.uuid4().hex[:8].upper()}"
    try:
        await AsyncBox.set_env(key, "secret-value", **opts)
        env = await AsyncBox.list_env(**opts)
        assert key in env
    finally:
        await AsyncBox.delete_env(key, **opts)
        env = await AsyncBox.list_env(**opts)
        assert key not in env
