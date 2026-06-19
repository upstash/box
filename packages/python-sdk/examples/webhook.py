"""Fire-and-forget agent run — the backend POSTs to your webhook on completion."""

import asyncio

from upstash_box import Agent, AsyncBox, ClaudeCode


async def main() -> None:
    box = await AsyncBox.create(
        agent={"harness": Agent.CLAUDE_CODE, "model": ClaudeCode.SONNET_4_5},
    )
    async with box:
        run = await box.agent.run(
            prompt="Refactor the auth module and run the tests",
            webhook={
                "url": "https://example.com/box-callback",
                "headers": {"Authorization": "Bearer my-token"},
            },
        )
        # Returns immediately with a run id; the result arrives via the webhook.
        print("accepted run:", run.id)


if __name__ == "__main__":
    asyncio.run(main())
