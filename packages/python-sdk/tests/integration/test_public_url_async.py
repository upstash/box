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

        # The list endpoint returns leaner records; just assert the preview exists.
        listed = await box.list_public_urls()
        assert len(listed["public_urls"]) >= 1

        await box.delete_public_url(3000)
    finally:
        await box.delete()
