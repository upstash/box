"""A custom harness process. The backend invokes this with
`-p <prompt> --model <model> --stream`; it emits the box-sse-v1 protocol.

Run it as the `command` of an Agent.CUSTOM box, e.g.:

    box = await AsyncBox.create(agent={
        "harness": Agent.CUSTOM,
        "custom_harness": {"command": "python", "args": ["my_harness.py"]},
    })
"""

import asyncio

from upstash_box import CustomHarnessDone, run_custom_harness


async def main() -> None:
    async def handler(ctx, emit):
        emit.reasoning("thinking about the prompt...")
        emit.tool({"name": "echo", "input": {"prompt": ctx.prompt}})
        output = f"received: {ctx.prompt}"
        emit.text(output)
        return CustomHarnessDone(
            output=output,
            input_tokens=len(ctx.prompt.split()),
            output_tokens=len(output.split()),
            session_id=ctx.session_id,
        )

    await run_custom_harness(handler)


if __name__ == "__main__":
    asyncio.run(main())
