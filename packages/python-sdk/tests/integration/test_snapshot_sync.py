"""Verify snapshot readiness and restoration through the generated sync client."""

import uuid

import pytest

from upstash_box import Box

pytestmark = pytest.mark.integration


def test_snapshot_and_restore(opts):
    box = Box.create(runtime="node", **opts)
    snapshot = None
    restored = None
    try:
        box.files.write(path="state.txt", content="checkpoint-data")
        snapshot = box.snapshot(name=f"py-sync-it-{uuid.uuid4().hex[:8]}")
        assert snapshot.status == "ready"

        restored = Box.from_snapshot(snapshot.id, **opts)
        assert restored.files.read("state.txt") == "checkpoint-data"
    finally:
        if restored is not None:
            restored.delete()
        if snapshot is not None:
            box.delete_snapshot(snapshot.id)
        box.delete()
