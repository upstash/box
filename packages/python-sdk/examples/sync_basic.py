"""The same flow with the synchronous client."""

from upstash_box import Agent, Box, ClaudeCode


def main() -> None:
    box = Box.create(
        runtime="node",
        agent={"harness": Agent.CLAUDE_CODE, "model": ClaudeCode.SONNET_4_5},
    )
    with box:
        run = box.exec.command("node --version")
        print(run.result)

        for chunk in box.agent.stream(prompt="Write a haiku about sandboxes"):
            if chunk.type == "text-delta":
                print(chunk.text, end="", flush=True)
        print()


if __name__ == "__main__":
    main()
