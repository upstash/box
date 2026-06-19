"""Lifecycle + config: configure_model, network policy, status, pause/resume,
logs, list_runs."""

import pytest

from upstash_box import Agent, AsyncBox, ClaudeCode

pytestmark = pytest.mark.integration


async def test_config_status_logs_runs(opts):
    box = await AsyncBox.create(
        runtime="node",
        agent={"harness": Agent.CLAUDE_CODE, "model": ClaudeCode.SONNET_4_5},
        **opts,
    )
    try:
        # configure_model updates model_config immediately
        await box.configure_model(ClaudeCode.HAIKU_4_5.value)
        assert box.model_config["model"] == ClaudeCode.HAIKU_4_5.value

        # network policy round-trips
        await box.update_network_policy({"mode": "deny-all"})
        assert box.network_policy == {"mode": "deny-all"}
        await box.update_network_policy({"mode": "custom", "allowed_domains": ["api.github.com"]})
        assert box.network_policy["mode"] == "custom"
        await box.update_network_policy({"mode": "allow-all"})

        # produce a run, then inspect status/logs/runs
        await box.exec.command("echo lifecycle")
        status = await box.get_status()
        assert "status" in status
        logs = await box.logs()
        assert isinstance(logs, list)
        runs = await box.list_runs()
        assert isinstance(runs, list)
    finally:
        await box.delete()


async def test_pause_resume(opts):
    box = await AsyncBox.create(runtime="node", **opts)
    try:
        await box.pause()
        await box.resume()
        run = await box.exec.command("echo resumed")
        assert "resumed" in run.result
    finally:
        await box.delete()
