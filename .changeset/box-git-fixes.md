---
"@upstash/box": patch
---

Fix three things in the git namespace that made it unusable from a caller's point of view.

- `git.updateConfig()` sent its request to `/v2/box/{id}/git-config`, which the coordinator does not serve. The identity endpoint is `/v2/box/{id}/config/git`, so every call returned 404 and no git identity was ever set through the SDK.
- `git.exec()` results now carry `exit_code`. The API has always returned it; the type omitted it, so callers could not tell a failed git command (for example exit 128 when the folder is not a repository) from a successful one.
- `git.clone()` accepts `folder`, naming the directory the repository is cloned into. Unlike every other git operation, where the folder is an existing directory derived from `cd()`, clone's folder is the destination and does not exist yet, so it could not be expressed at all: `cd()` fails on a directory the clone is about to create.
