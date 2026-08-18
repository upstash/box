---
"@upstash/box": patch
---

feat: opt into built-in captcha solving on `tab.act()`

`act()` now accepts `solveCaptchas` (default `false`) to transparently solve a
reCAPTCHA v2 checkbox blocking the page before it runs your instruction (also on
the replay form). The result carries a `captcha` outcome
(`{ attempted, solved, skipped? }`) when solving was requested. New
`BrowserActOptions` and `BrowserCaptchaOutcome` types are exported. Best-effort
and act-only. Beta: covers the reCAPTCHA v2 checkbox only.
