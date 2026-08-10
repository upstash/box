---
"@upstash/box": patch
---

Add `box.browser.recordings.download(recordingId, { path? })` to save a
recording's video to a local file (streamed to disk, parent directories
created as needed) and expose `mp4SizeBytes` on recording metadata.
Recordings are downloaded as MP4; recordings captured before MP4 support
(or whose remux failed) download as raw MPEG-TS with a `.ts` extension.
