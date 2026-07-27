---
"@upstash/box": minor
---

Add the browser API: create boxes with `browser: true` and drive a headless Chromium via `box.browser` — tab lifecycle (`tab.create` with lifecycle-aware navigation, `listTabs`, `getTab`, `close`), page operations (`goto`, `content`, options-based `screenshot` with full-page capture), AI operations (`extract`/`observe`/`act`/`run` with Zod 3/4 schema-validated structured output), authenticated `cdpUrl()`/`liveViewUrl()` endpoints, and session recordings (`recordings.start/stop/list/get` with auto-paginated listing and HLS playback URLs).
