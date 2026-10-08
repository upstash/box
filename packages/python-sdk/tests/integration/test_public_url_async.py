"""Public URL create / list / delete."""

import pytest

from upstash_box import AsyncBox

pytestmark = pytest.mark.integration


async def test_public_url_crud(opts):
    box = await AsyncBox.create(runtime="node", keep_alive=True, **opts)
    try:
        url = await box.get_public_url(3000)
        assert url.url
        assert url.port == 3000

        # List items carry auth flags, never the secrets from create.
        listed = await box.list_public_urls()
        item = next(p for p in listed["public_urls"] if p.port == 3000)
        assert item.id
        assert item.url == url.url
        assert item.created_at > 0
        assert isinstance(item.basic_auth, bool)
        assert isinstance(item.bearer_token, bool)

        await box.delete_public_url(3000)
    finally:
        await box.delete()
