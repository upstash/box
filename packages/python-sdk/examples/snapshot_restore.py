"""Save workspace state as a snapshot, then restore it into a fresh box."""

import asyncio

from upstash_box import Agent, AsyncBox, ClaudeCode


async def main() -> None:
    box = await AsyncBox.create(
        runtime="node",
        agent={"harness": Agent.CLAUDE_CODE, "model": ClaudeCode.SONNET_4_5},
    )
    async with box:
        await box.files.write(path="state.txt", content="checkpoint data")
        snapshot = await box.snapshot(name="checkpoint-1")
        print("snapshot:", snapshot.id)

    restored = await AsyncBox.from_snapshot(snapshot.id, size="medium")
    async with restored:
        print(await restored.files.read("state.txt"))


if __name__ == "__main__":
    asyncio.run(main())
