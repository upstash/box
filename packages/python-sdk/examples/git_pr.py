"""Clone a repo, let the agent make a change, commit, push, and open a PR."""

import asyncio
import os

from upstash_box import Agent, AsyncBox, ClaudeCode


async def main() -> None:
    box = await AsyncBox.create(
        runtime="node",
        agent={"harness": Agent.CLAUDE_CODE, "model": ClaudeCode.SONNET_4_5},
        git={"token": os.environ["GITHUB_TOKEN"]},
    )
    async with box:
        await box.git.clone(repo="https://github.com/your/repo", branch="main")
        await box.cd("repo")
        await box.git.checkout(branch="box/update-readme")

        await box.agent.run(prompt="Add a Quick Start section to the README")

        await box.git.commit(message="docs: add quick start")
        await box.git.push(branch="box/update-readme")
        pr = await box.git.create_pr(title="docs: add quick start", body="Automated by Box")
        print("opened PR:", pr.url)


if __name__ == "__main__":
    asyncio.run(main())
