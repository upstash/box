---
"@upstash/box": patch
---

Check sooner whether a new box or snapshot is ready. `Box.create`, `Box.fromSnapshot` and `box.snapshot` waited a fixed 2 seconds between status checks; the first check now comes after 100 ms and the wait grows to 2 seconds.
