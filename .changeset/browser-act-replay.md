---
"@upstash/box": minor
---

feat: replay a resolved browser action with `tab.act(action)` (no LLM, no key)

`observe()` now returns each element's suggested `method` and `arguments`
alongside `selector`, and `act()` accepts a pre-resolved action
(`BrowserObserveElement` or `BrowserActAction`) in addition to a natural-language
string. Passing an action replays it deterministically: no LLM call, no tokens,
and no model provider key required. Resolve a step once with `observe()`, cache
the returned action, and replay it across pages or runs. A new `BrowserAction`
type (`BrowserObserveElement | BrowserActAction`) is exported.
