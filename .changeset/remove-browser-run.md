---
"@upstash/box": minor
---

**Breaking:** remove `tab.run()` (the autonomous multi-step browser agent) and the `BrowserRunOptions` / `BrowserRunResult` / `BrowserRunStep` types.

Stagehand v4 removed the underlying agent primitive, so the DOM-aware browser now exposes `observe`, `act`, and `extract` only. For multi-step goals, drive `act` / `observe` from your own loop (replay a resolved step with `act(action)` for no-LLM, no-key execution), or connect over CDP with Playwright / Puppeteer.
