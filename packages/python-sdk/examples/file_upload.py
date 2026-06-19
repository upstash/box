"""Upload local files into the box, then read one back."""

import asyncio

from upstash_box import AsyncEphemeralBox


async def main() -> None:
    box = await AsyncEphemeralBox.create(runtime="node", ttl=600)
    async with box:
        await box.files.upload([{"path": "./README.md", "destination": "README.md"}])
        content = await box.files.read("README.md")
        print(content[:200])


if __name__ == "__main__":
    asyncio.run(main())
