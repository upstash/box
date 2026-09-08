---
"@upstash/box-cli": patch
---

Give the git and file wrappers escape hatches where they diverge from the tools they wrap. Every default is unchanged.

- `box git push` sends the checked-out branch. With none, the API pushes to a branch named after the box, after a `checkout -B` that force-moves the ref, so a push could land under the box id and leave you on a branch you never asked for. A detached HEAD is now an error naming `--branch` rather than a guess.
- `box git commit --staged-only` commits exactly the index. The commit endpoint runs `git add -A` first, so someone who staged one file still commits every untracked file in the tree. Without the flag the behaviour is unchanged, but it now warns on stderr, naming the files it is about to sweep in.
- `box git checkout --new` creates the branch and fails if it exists. Plain checkout prefers an existing local or remote-tracking branch, so asking for a fresh one can silently restore old work into the tree.
- `box git create-pr --body-file` and `box git create-issue --body-file`, matching `gh`. A body worth writing does not survive shell quoting; `-` reads stdin.
- `box files download <file>` downloads the file. Given a file path it used to create an empty local directory named after it and exit 0, which is a silently wrong result rather than an error. `--out` names the destination.
