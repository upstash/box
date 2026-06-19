"""Create a box, run an agent, read the output. Requires UPSTASH_BOX_API_KEY."""

import asyncio

from upstash_box import Agent, AsyncBox, ClaudeCode


async def main() -> None:
    box = await AsyncBox.create(
        runtime="node",
        agent={"harness": Agent.CLAUDE_CODE, "model": ClaudeCode.SONNET_4_5},
    )
    async with box:
        run = await box.agent.run(prompt="Create a hello world Express server")
        print(run.result)
        print("cost:", run.cost.total_usd, "USD")


if __name__ == "__main__":
    asyncio.run(main())
