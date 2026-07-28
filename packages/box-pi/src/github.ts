/**
 * Copyright Upstash, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * GitHub control-plane helpers.
 *
 * These all run on the HOST via the `gh` CLI: minting a token and making GitHub
 * REST API calls (create branch ref, merge, delete, lookups). We never run
 * git-over-the-network on the host — the actual clone/commit/push happen INSIDE
 * the box via the Box git API (see sync.ts). The only thing that crosses over
 * is a short-lived token, passed to the box as the push credential.
 */

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

export interface RepoSlug {
  owner: string
  repo: string
}

/**
 * Detect the git origin URL and current branch of a local checkout (the host
 * Pi project directory), so a session launched without --repo still syncs to
 * the repo you're sitting in. Returns undefined if it isn't a git repo with an
 * origin remote.
 */
export async function detectLocalRepo(
  pi: ExtensionAPI,
  cwd: string,
): Promise<{ url: string; branch: string } | undefined> {
  try {
    const remote = await pi.exec('git', ['-C', cwd, 'remote', 'get-url', 'origin'])
    const url = remote.code === 0 ? remote.stdout.trim() : ''
    if (!url) return undefined
    const head = await pi.exec('git', ['-C', cwd, 'rev-parse', '--abbrev-ref', 'HEAD'])
    const branch = head.code === 0 ? head.stdout.trim() : ''
    return { url, branch: branch && branch !== 'HEAD' ? branch : '' }
  } catch {
    return undefined
  }
}

/** Parse `owner/repo` from a GitHub URL. Undefined if the HOST isn't github.com. */
export function parseRepoSlug(url: string): RepoSlug | undefined {
  const trimmed = url.trim()

  // scp-style SSH shorthand `[user@]host:owner/repo[.git]` must be matched BEFORE
  // the URL parser: `new URL('git@github.com:acme/api')` reads `acme` as a port
  // and throws. The negative lookahead `(?!\/\/)` keeps `https://…` on the URL
  // branch below. `/i` mirrors the URL branch so `.GIT` (uppercase) strips too.
  const scp = trimmed.match(/^(?:[^@/]+@)?([^/:]+):(?!\/\/)([^/]+)\/([^/]+?)(?:\.git)?\/?$/i)
  if (scp) {
    const [, host, owner, repo] = scp
    return host.toLowerCase() === 'github.com' ? { owner, repo } : undefined
  }

  // Anything else goes through the URL parser, which gives us the REAL hostname —
  // regex-based host matching can be spoofed (e.g. `https://evil.com/@github.com/…`
  // where the userinfo *looks* like a host but isn't).
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    return undefined
  }
  if (parsed.hostname.toLowerCase() !== 'github.com') return undefined
  // Require EXACTLY `owner/repo` (with optional `.git`/trailing slash — both
  // filtered by the empty-segment drop). A URL like `.../owner/repo/tree/main`
  // is a GitHub tree/blob URL, not a clone URL — accepting it would silently
  // clone the repo root when the caller pointed at a subpath.
  const segments = parsed.pathname.split('/').filter((s) => s.length > 0)
  if (segments.length !== 2) return undefined
  const [owner, repoRaw] = segments
  const repo = repoRaw.replace(/\.git$/i, '')
  return owner && repo ? { owner, repo } : undefined
}

/** Build a GitHub compare URL (base...branch — shows the diff and a "Create pull request" button). */
export function compareUrl(slug: RepoSlug, base: string, branch: string): string {
  return `https://github.com/${slug.owner}/${slug.repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}`
}

/** URL to a branch's tree (repo root) on GitHub. */
export function branchUrl(slug: RepoSlug, branch: string): string {
  return `https://github.com/${slug.owner}/${slug.repo}/tree/${branch}`
}

/** URL that opens GitHub's pre-filled "Open a pull request" page (base...branch). */
export function prUrl(slug: RepoSlug, base: string, branch: string): string {
  return `${compareUrl(slug, base, branch)}?expand=1`
}

interface GhResult {
  ok: boolean
  stdout: string
  stderr: string
}

async function gh(pi: ExtensionAPI, args: string[]): Promise<GhResult> {
  const res = await pi.exec('gh', args)
  return { ok: res.code === 0, stdout: res.stdout?.trim() ?? '', stderr: res.stderr?.trim() ?? '' }
}

/** Get a GitHub token from the user's gh login. Undefined if gh is missing/unauthenticated. */
export async function getGithubToken(pi: ExtensionAPI): Promise<string | undefined> {
  try {
    const res = await gh(pi, ['auth', 'token'])
    return res.ok && res.stdout ? res.stdout : undefined
  } catch {
    return undefined
  }
}

/** Resolve the repository's default branch (used as the base when --branch is not given). */
export async function getDefaultBranch(pi: ExtensionAPI, slug: RepoSlug): Promise<string | undefined> {
  const res = await gh(pi, ['api', `repos/${slug.owner}/${slug.repo}`, '--jq', '.default_branch'])
  return res.ok && res.stdout ? res.stdout : undefined
}

/** Get the commit SHA a branch points at. Undefined if the branch doesn't exist. */
export async function getBranchSha(pi: ExtensionAPI, slug: RepoSlug, branch: string): Promise<string | undefined> {
  const res = await gh(pi, ['api', `repos/${slug.owner}/${slug.repo}/git/ref/heads/${branch}`, '--jq', '.object.sha'])
  return res.ok && res.stdout ? res.stdout : undefined
}

/** Create branch `name` pointing at `sha`. Idempotent: an already-existing ref is treated as success. */
export async function ensureBranch(pi: ExtensionAPI, slug: RepoSlug, name: string, sha: string): Promise<void> {
  const res = await gh(pi, [
    'api',
    '--method',
    'POST',
    `repos/${slug.owner}/${slug.repo}/git/refs`,
    '-f',
    `ref=refs/heads/${name}`,
    '-f',
    `sha=${sha}`,
  ])
  if (res.ok) return
  if (/already exists/i.test(res.stderr)) return // 422: ref already present
  throw new Error(res.stderr || 'Failed to create branch')
}

/** Merge `head` into `base` via the GitHub API (creates a merge commit). */
export async function mergeBranch(
  pi: ExtensionAPI,
  slug: RepoSlug,
  base: string,
  head: string,
): Promise<{ ok: boolean; message: string }> {
  const res = await gh(pi, [
    'api',
    '--method',
    'POST',
    `repos/${slug.owner}/${slug.repo}/merges`,
    '-f',
    `base=${base}`,
    '-f',
    `head=${head}`,
  ])
  if (res.ok) return { ok: true, message: 'merged' }
  // 204 (nothing to merge) and "already merged" are not failures.
  if (/already merged|nothing to merge/i.test(res.stderr)) return { ok: true, message: 'already up to date' }
  return { ok: false, message: res.stderr || 'merge failed' }
}

/** Delete a remote branch ref. Best-effort. */
export async function deleteBranch(pi: ExtensionAPI, slug: RepoSlug, name: string): Promise<void> {
  await gh(pi, ['api', '--method', 'DELETE', `repos/${slug.owner}/${slug.repo}/git/refs/heads/${name}`])
}

/**
 * Number of commits `branch` is ahead of `base` on GitHub (its actual
 * contribution). Undefined if the comparison can't be made. Used to decide
 * whether a throwaway branch contributed anything before deleting it.
 */
export async function getBranchAhead(
  pi: ExtensionAPI,
  slug: RepoSlug,
  base: string,
  branch: string,
): Promise<number | undefined> {
  const res = await gh(pi, [
    'api',
    `repos/${slug.owner}/${slug.repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(branch)}`,
    '--jq',
    '.ahead_by',
  ])
  if (!res.ok) return undefined
  const n = Number(res.stdout)
  return Number.isFinite(n) ? n : undefined
}
