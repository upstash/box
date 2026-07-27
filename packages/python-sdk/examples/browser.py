"""Headless browser — box.browser.* on a lightweight box.

Creating a box with ``browser=True`` provisions Chromium; all page operations
(content, screenshots, AI extract/act/run) work headless. Mirrors the JS
examples ``browser.ts`` / ``headless-browser.ts``.

Run: python examples/browser.py  (needs UPSTASH_BOX_API_KEY)
"""

import asyncio

from pydantic import BaseModel

from upstash_box import AsyncBox


class Pricing(BaseModel):
    plan: str
    price_per_100k_commands_usd: float


async def main() -> None:
    box = await AsyncBox.create(browser=True)
    print(f"box: {box.id}")

    try:
        tab = await box.browser.tab.create("about:blank")
        page = await tab.goto("https://upstash.com/pricing/redis")
        print(f"title: {page.title}")

        content = await tab.content()
        print(f"text: {content.text[:200]}...")

        # Metered: extracts structured data with a browser AI agent.
        pricing = await tab.extract(
            "Extract the pay-as-you-go Redis plan name and its price per 100K commands",
            Pricing,
        )
        print(f"extracted: {pricing}")

        png = await tab.screenshot(full_page=True)
        print(f"screenshot: {len(png)} bytes")

        tabs = await box.browser.list_tabs()
        print(f"open tabs: {[t.id for t in tabs]}")

        await tab.close()
    finally:
        await box.delete()


if __name__ == "__main__":
    asyncio.run(main())
