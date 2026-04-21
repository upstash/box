---
"@upstash/box": minor
---

Rename preview URL API to public URL, and support `keepAlive`/`initCommand` in `Box.fromSnapshot()`.

- Added `box.getPublicUrl()`, `box.listPublicUrls()`, `box.deletePublicUrl()` and a new `PublicUrl` type.
- `box.getPreviewUrl()`, `box.listPreviews()`, `box.deletePreview()`, and the `Preview` type are now `@deprecated` aliases that delegate to the new names and will be removed in a future major. Existing code continues to work unchanged.
- `Box.fromSnapshot()` now accepts `keepAlive` and `initCommand` (previously threw `"Keep-alive boxes from snapshot are not supported yet"`).
- Docs: corrected API key prefix from `abx_` to `box_` and added an SSH section.
