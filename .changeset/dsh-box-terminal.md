---
"@upstash/dsh-box": minor
---

Implement `spawnTerminal()` and `inherit` output, and move the seam pin to
`0.1.1-rc.2`.

Terminal sessions run on a real PTY sized at creation, so a shell reports the
right dimensions on its first read. `inspectForeground()` resolves the
foreground process group from `/proc`, and `signalForeground()` delivers to that
group rather than the session leader, so interrupting a running command leaves
the shell alive. Teardown is idempotent and reaps the whole session.

`inherit` writes a remote process's bytes to the harness's own stdout and
stderr. A remote process has no descriptor to hand over, so this copies rather
than inherits, and the child cannot detect a TTY through it.

The published seam now exports `SubprocessRuntime` under its own name, so the
`SubprocessService` alias is gone.
