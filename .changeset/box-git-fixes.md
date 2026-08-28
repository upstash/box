---
"@upstash/box": patch
---

Fix a lost exit status in `exec.stream()`, and three things in the git namespace that made it unusable from a caller's point of view.

- `exec.stream()` could end without an `exit` chunk. The `event: exit` marker and its `data:` payload can arrive in separate network reads; the parser matched a half-arrived line and returned, ending the stream with no exit status at all. A caller had no way to tell whether the command succeeded, and about one run in thirty of a short command was affected. The payload is now waited for.

- `git.updateConfig()` sent its request to `/v2/box/{id}/git-config`, which the coordinator does not serve. The identity endpoint is `/v2/box/{id}/config/git`, so every call returned 404 and no git identity was ever set through the SDK.
- `git.exec()` results now carry `exit_code`. The API has always returned it; the type omitted it, so callers could not tell a failed git command (for example exit 128 when the folder is not a repository) from a successful one.
- `git.clone()` accepts `folder`, naming the directory the repository is cloned into. Unlike every other git operation, where the folder is an existing directory derived from `cd()`, clone's folder is the destination and does not exist yet, so it could not be expressed at all: `cd()` fails on a directory the clone is about to create.
