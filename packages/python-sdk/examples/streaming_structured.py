"""Streaming output and structured (Pydantic) output."""

import asyncio

from pydantic import BaseModel

from upstash_box import Agent, AsyncBox, ClaudeCode


class Analysis(BaseModel):
    summary: str
    score: int


async def main() -> None:
    box = await AsyncBox.create(
        agent={"harness": Agent.CLAUDE_CODE, "model": ClaudeCode.SONNET_4_5},
    )
    async with box:
        # Streaming
        stream = await box.agent.stream(prompt="Explain async iterators briefly")
        async for chunk in stream:
            if chunk.type == "text-delta":
                print(chunk.text, end="", flush=True)
            elif chunk.type == "tool-call":
                print(f"\n[tool] {chunk.tool_name} {chunk.input}")
        print()

        # Structured output
        run = await box.agent.run(
            prompt="Analyze this repo and score code quality 0-100",
            response_schema=Analysis,
        )
        result: Analysis = run.result
        print(result.summary, result.score)


if __name__ == "__main__":
    asyncio.run(main())
