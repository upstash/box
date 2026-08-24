---
"@upstash/box": patch
---

Add filesystem metadata operations to `box.files`:

- `stat(path, { follow })` — type (file/directory/symlink/other), size, mtime,
  inode, and an opaque `version` token for optimistic-concurrency guards.
  Defaults to lstat; `follow: true` dereferences a final symlink.
- `mkdir(path, { parents })`, `rename(from, to)`, `remove(path, { recursive })`.
- `read(path, { offset, length })` — bounded byte-range read, so a large file can
  be sliced instead of pulled whole.
