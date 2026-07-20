---
"@upstash/box": patch
---

Add box labels: `labels` on create (`Box.create`, `Box.fromSnapshot`, `EphemeralBox.create`, `EphemeralBox.fromSnapshot`), a `label` filter on `Box.list`, `labels` on `BoxData`, and a `box.labels` namespace (`add`, `remove`, `list`) to manage labels on a running box.
