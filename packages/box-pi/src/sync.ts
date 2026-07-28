/**
 * Copyright Upstash, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Box-side git push.
 *
 * The agent commits its own work inside the box (it's prompted to commit but
 * not push). The extension only pushes those commits to the session's GitHub
 * branch via the Box git API.
 *
 * Credentials: the box's git credential store is seeded by `git.clone` at
 * session start, but `gh`-minted tokens can expire or rotate mid-session. So
 * before every push we re-seed the credential store (and the gh CLI config,
 * which `git.createPR` uses) with a freshly minted token — the exact same
 * `git credential approve` mechanism the Box backend itself uses. This makes
 * pushes immune to token expiry.
 *
 * Pushes are serialized so overlapping triggers can't race, and a branch with
 * nothing ahead of its remote is skipped.
 */

import type { Box } from '@upstash/box'
import { execCommand, withRecovery } from './box.ts'
import { shellQuote } from './util.ts'

export interface PushTarget {
  /**
   * The box to push from. Git operations run in the box working directory the
   * SDK tracks (`box.cd(...)` is called once at session start).
   */
  box: Box
  /** The session's git branch inside the box (the Box push API requires it). */
  branch: string
  /**
   * True when this session is configured for GitHub sync (repo has a github.com
   * origin and gh was authenticated at session start). Token availability at
   * push time is validated separately in `doPush` — a missing token here is a
   * real failure, not a "no sync configured" no-op.
   */
  syncConfigured: boolean
}

export interface PushResult {
  pushed: boolean
}

/**
 * Re-seed the box's GitHub credentials: the git credential store (used by
 * push/pull) and the gh CLI hosts config (used by `git.createPR`). Idempotent —
 * `git credential approve` overwrites the stored entry for the same host+user.
 */
export async function refreshGitCredentials(box: Box, token: string): Promise<void> {
  const q = shellQuote(token)
  const cred =
    `git config --global credential.helper store && ` +
    `printf 'protocol=https\\nhost=github.com\\nusername=x-access-token\\npassword=%s\\n' ${q} | git credential approve`
  const ghCfg =
    `mkdir -p ~/.config/gh && ` +
    `printf 'github.com:\\n    oauth_token: %s\\n    user: x-access-token\\n    git_protocol: https\\n' ${q} > ~/.config/gh/hosts.yml`
  const res = await execCommand(box, `${cred} && ${ghCfg}`)
  if ((res.exitCode ?? 0) !== 0) {
    throw new Error(`Failed to refresh GitHub credentials in the box (exit ${res.exitCode})`)
  }
}

/**
 * Commits the local branch is ahead of its remote counterpart, via the Box git
 * API. Undefined when it can't be determined (e.g. the remote ref is missing) —
 * callers should then attempt the push rather than skip it.
 */
export async function getAheadCount(box: Box, branch: string): Promise<number | undefined> {
  try {
    const res = await withRecovery(box, () =>
      box.git.exec({ args: ['rev-list', '--count', `origin/${branch}..HEAD`] }),
    )
    const n = Number(res.output.trim())
    return Number.isFinite(n) ? n : undefined
  } catch {
    return undefined
  }
}

// Serialize pushes across the whole extension so concurrent triggers don't race.
let queue: Promise<unknown> = Promise.resolve()

export function pushChanges(target: PushTarget, token: string | undefined): Promise<PushResult> {
  const next = queue.then(() => doPush(target, token))
  queue = next.catch(() => {
    /* keep the chain alive even if one push throws */
  })
  return next
}

async function doPush(target: PushTarget, token: string | undefined): Promise<PushResult> {
  // Sync genuinely off -> no-op. But sync configured + no token is a real failure,
  // not "nothing to push": swallowing it would let callers proceed on stale remote.
  if (!target.syncConfigured) return { pushed: false }
  if (!token) throw new Error('GitHub push token unavailable — run `gh auth login` and retry.')

  const { box, branch } = target

  // Nothing to push: no local commits ahead of the remote branch. Unknown
  // (undefined) falls through to the push — a harmless no-op push beats
  // silently skipping real work.
  const ahead = await getAheadCount(box, branch)
  if (ahead === 0) return { pushed: false }

  await refreshGitCredentials(box, token)
  await withRecovery(box, () => box.git.push({ branch }))
  return { pushed: true }
}
