---
"@upstash/box-cli": patch
---

Fix the git and file wrappers where they diverge from the tools they wrap.

Two behaviours change, both because the old ones were wrong:

- **`box git push` with no `--branch` now pushes the checked-out branch.** It used to send nothing, and the API then pushes to a branch named after the box, after a `checkout -B` that force-moves the ref — so a push landed under the box id and left you on a branch you never asked for. A detached HEAD is now an error naming `--branch` rather than a guess.
- **`box files download <file>` downloads the file.** Given a file path it used to create an empty local directory named after it and exit 0, which is a silently wrong result rather than an error. `--out` names the destination; folder downloads are unchanged.

`box git commit` gains `--staged-only`, which commits exactly the index. The commit endpoint runs `git add -A` first, so someone who staged one file still commits every untracked file in the tree. What gets committed without the flag is unchanged, but the command now writes a warning to stderr naming the files it is about to sweep in — so existing calls commit the same thing and say more while doing it.

The remaining additions change nothing for existing calls:
- `box git checkout --new` creates the branch and fails if it exists. Plain checkout prefers an existing local or remote-tracking branch, so asking for a fresh one can silently restore old work into the tree.
- `box git create-pr --body-file` and `box git create-issue --body-file`, matching `gh`. A body worth writing does not survive shell quoting; `-` reads stdin.
