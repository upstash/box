---
"@upstash/box": patch
---

Reject an empty id list in `Box.delete` and `Box.deleteSnapshots` instead of deleting everything.

`Box.delete({ boxIds: [] })` sent `{"ids": []}`, and the API read an empty list as "no filter", so it deleted every box on the account. A script that computed its id list and came up empty wiped the account instead of doing nothing. `Box.deleteSnapshots({ snapshotIds: [] })` had the same shape.

Both now throw a `BoxError` before any request is made when the list is empty or contains a blank id. `EphemeralBox.delete` and `EphemeralBox.deleteSnapshots` are the same functions, so they are covered too.

Calling `Box.deleteSnapshots()` with no `snapshotIds` still deletes every snapshot, as documented. It now says so explicitly by sending `?all=true`, so the API no longer has to infer "everything" from a missing list.
