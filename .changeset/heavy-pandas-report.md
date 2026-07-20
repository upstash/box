---
"@upstash/box": patch
"@upstash/box-cli": patch
---

Add anonymous client telemetry, following the same header convention as the other Upstash SDKs: every API request carries `Upstash-Telemetry-Sdk`, `Upstash-Telemetry-Runtime`, and `Upstash-Telemetry-Platform` headers describing the SDK version, JS runtime, and deployment platform. No user data, request payloads, or identifiers are collected. Disable by setting the `UPSTASH_DISABLE_TELEMETRY` environment variable, or per client with the `enableTelemetry: false` config option (the only way to opt out on runtimes without `process.env`, such as Cloudflare Workers — which are now also detected as platform `cloudflare` via the `caches.default` global).

The CLI appends its own identity (`@upstash/box-cli@<version>`) to the SDK telemetry chain, and `box --version` now reports the real package version (previously stuck at 0.1.0). Package versions embedded in the code are generated from package.json at build time.
