"""Schedule lifecycle — create, list, get, pause, resume, delete."""

import pytest

from upstash_box import AsyncBox

pytestmark = pytest.mark.integration


async def test_exec_schedule_crud(opts):
    box = await AsyncBox.create(runtime="node", keep_alive=True, **opts)
    try:
        sched = await box.schedule.exec(
            cron="*/10 * * * *",
            command=["bash", "-c", "echo scheduled >> /workspace/home/cron.log"],
        )
        assert sched.id
        assert sched.type == "exec"
        assert sched.status == "active"

        listed = await box.schedule.list()
        assert any(s.id == sched.id for s in listed)

        got = await box.schedule.get(sched.id)
        assert got.id == sched.id

        await box.schedule.pause(sched.id)
        assert (await box.schedule.get(sched.id)).status == "paused"

        await box.schedule.resume(sched.id)
        assert (await box.schedule.get(sched.id)).status == "active"

        await box.schedule.delete(sched.id)
    finally:
        await box.delete()
