"""Browser smoke — tab lifecycle, content, screenshot, CDP/live-view URLs.

Mirrors packages/sdk/src/__tests__/integration/browser.integration.test.ts.
Non-metered operations only (no extract/act/run).
"""

import pytest

from upstash_box import AsyncBox

pytestmark = pytest.mark.integration

PNG_MAGIC = b"\x89PNG"


async def test_browser_smoke(opts):
    box = await AsyncBox.create(browser=True, **opts)
    try:
        tab = await box.browser.tab.create("https://example.com")
        assert tab.id

        content = await tab.content()
        assert "example.com" in content.url
        assert "example" in content.text.lower()

        png = await tab.screenshot()
        assert isinstance(png, bytes)
        assert png[:4] == PNG_MAGIC

        tabs = await box.browser.list_tabs()
        assert any(t.id == tab.id for t in tabs)

        cdp_url = await box.browser.cdp_url()
        assert cdp_url.startswith("wss://")
        assert "token=" in cdp_url

        live_view_url = await tab.live_view_url()
        assert live_view_url.startswith("https://")
        assert "token=" in live_view_url

        await tab.close()
    finally:
        await box.delete()
