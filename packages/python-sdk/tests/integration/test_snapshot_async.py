"""Snapshot create / list / restore (from_snapshot) / delete."""

import uuid

import pytest

from upstash_box import AsyncBox

pytestmark = pytest.mark.integration


async def test_snapshot_and_restore(opts):
    box = await AsyncBox.create(runtime="node", **opts)
    snapshot = None
    restored = None
    try:
        await box.files.write(path="state.txt", content="checkpoint-data")
        snapshot = await box.snapshot(name=f"py-it-{uuid.uuid4().hex[:8]}")
        assert snapshot.status == "ready"

        snaps = await box.list_snapshots()
        assert any(s.id == snapshot.id for s in snaps)

        restored = await AsyncBox.from_snapshot(snapshot.id, **opts)
        assert await restored.files.read("state.txt") == "checkpoint-data"
    finally:
        if restored is not None:
            await restored.delete()
        if snapshot is not None:
            await box.delete_snapshot(snapshot.id)
        await box.delete()
