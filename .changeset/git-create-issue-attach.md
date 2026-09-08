---
"@upstash/box": patch
"@upstash/box-cli": patch
---

Add `git.createIssue()` and file attachments for issues and pull requests.

`box.git.createIssue({ title })` opens a GitHub issue from a box. Both
`createIssue` and `createPR` accept `attach`, a list of image or video files
relative to the working directory, which are uploaded to the new item. Alt text
for an image is written as `shot.png#alt text`; a video cannot take alt text.
Reference an attachment from the body as `![alt](./shot.png)` and GitHub
rewrites it to point at the uploaded asset.

Both responses gain an optional `warning`, set when `gh` exits non-zero but
still returns a URL, which means the item exists while an attachment is missing,
or the pull request was already open.

The CLI gains `box git create-issue --title <title>` and a repeatable
`--attach <file>` on both `create-pr` and `create-issue`.
