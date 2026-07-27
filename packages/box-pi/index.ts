/**
 * Copyright Upstash, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * @upstash/box-pi — run Pi's tools inside a remote Upstash Box sandbox.
 *
 * The agent runs locally; only tool execution (bash + file I/O + search) is
 * redirected into a Box. Activation is launch-scoped via the `--box` flag; the
 * box is kept with the session (auto-paused when idle, reattached on resume)
 * and deleted when the session is deleted.
 *
 * Blueprint: the Daytona Pi extension (@daytona/pi), adapted to the Box API:
 * boxes idle-pause automatically and the coordinator auto-resumes them on the
 * next request, so there is no idle-stop knob and only thin client recovery.
 */

import { Box, BoxError, type BoxData, type BoxSize, type Runtime } from '@upstash/box'
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { resolveApiKey } from './src/auth.ts'
import { execCommand, isNotFound } from './src/box.ts'
import {
  type RepoSlug,
  branchUrl,
  compareUrl,
  deleteBranch,
  detectLocalRepo,
  ensureBranch,
  getBranchAhead,
  getBranchSha,
  getDefaultBranch,
  getGithubToken,
  mergeBranch,
  parseRepoSlug,
  prUrl,
} from './src/github.ts'
import { getAheadCount, pushChanges, refreshGitCredentials } from './src/sync.ts'
import { registerTools } from './src/tools.ts'
import { joinPath, normalizeRepoUrl, repoName, shellQuote, shortId } from './src/util.ts'

/** Session custom-entry type recording the box bound to this session. */
const SESSION_ENTRY = 'upstash-box-session'

/** Default workspace root inside a box (the SDK's Box.WORKSPACE is private). */
const WORKSPACE_ROOT = '/workspace/home'

/** Labels attached to every box we create, so orphans can be found and reaped. */
const CREATED_BY_LABEL = 'created-by:pi'

/** Git identity for the agent's commits inside the box. */
const GIT_USER_NAME = 'pi-agent'
const GIT_USER_EMAIL = 'agent@pi.upstash.com'

/** Valid --runtime / --size values, validated before Box.create for a clear error. */
const RUNTIMES = [
  'node',
  'python',
  'golang',
  'ruby',
  'rust',
  'node-alpine',
  'python-alpine',
  'golang-alpine',
  'ruby-alpine',
  'rust-alpine',
]
const SIZES = ['small', 'medium', 'large']

/** GitHub sync target for a session (set only when pushing is enabled). */
interface GitTarget {
  slug: RepoSlug
  base: string
  branch: string
}

/** Persisted record so a session can reattach its box on resume. */
interface SessionEntryData {
  boxId: string
  cwd: string
  git?: GitTarget
}

/** State for the box bound to the current session. */
interface ActiveBox {
  box: Box
  /** Working directory inside the box (repo root, or workspace when no repo). */
  cwd: string
  /** GitHub sync target — set only when the repo is on github.com and gh has a token. */
  git?: GitTarget
}

export default function (pi: ExtensionAPI) {
  pi.registerFlag('box', { description: 'Run tools inside an Upstash Box sandbox', type: 'boolean' })
  pi.registerFlag('repo', { description: 'Git repo to clone into the box', type: 'string' })
  pi.registerFlag('branch', { description: 'Branch to clone (with --repo)', type: 'string' })
  pi.registerFlag('runtime', { description: 'Box runtime image (node, python, golang, ruby, rust; -alpine variants)', type: 'string' })
  pi.registerFlag('size', { description: 'Box size: small, medium, or large', type: 'string' })

  // Resolved lazily on session_start (CLI flags are not available at load time).
  let active: ActiveBox | null = null
  // API key for the session; the SDK has no client object, so statics need it.
  let apiKey: string | undefined

  // Register all tools (each runs in the box when one is active).
  registerTools(pi, () => active)

  // --- Informational commands (read-only; don't change the backend) ---

  // Status for the active box: state, working dir, branch, sync status, GitHub link.
  pi.registerCommand('sandbox', {
    description: "Show the active Upstash Box's status",
    handler: async (_args, ctx) => {
      if (!active) {
        ctx.ui.notify('No Upstash Box is active. Launch Pi with --box.', 'warning')
        return
      }
      const { box, cwd, git } = active
      let state = 'unknown'
      try {
        state = (await box.getStatus()).status
      } catch {
        // Show last-known data if the status call fails.
      }
      const lines = [`☁ ${shortId(box.id)} · ${state} · ${box.size}${box.keepAlive ? ' · keep-alive' : ''}`, `cwd: ${cwd}`]
      if (git) {
        let sync = ''
        try {
          const ahead = await getAheadCount(box, git.branch)
          const st = await box.git.status()
          const dirty = st.split('\n').filter((l) => l.trim().length > 0).length
          sync = ` · ${ahead ?? '?'} unpushed${dirty ? `, ${dirty} uncommitted` : ''}`
        } catch {
          // status is best-effort
        }
        lines.push(`branch: ${git.branch} → ${git.base}${sync}`)
        lines.push(`github: ${branchUrl(git.slug, git.branch)}`)
      } else {
        lines.push('github sync: off (launch with --repo and `gh auth login`)')
      }
      ctx.ui.notify(lines.join('\n'), 'info')
    },
  })

  // Merge this session's branch into its base on GitHub (direct API merge).
  pi.registerCommand('merge', {
    description: "Merge this session's branch into its base on GitHub",
    handler: async (_args, ctx) => {
      if (!active?.git) {
        ctx.ui.notify('Merge needs a GitHub repo. Launch Pi with --repo.', 'warning')
        return
      }
      const { slug, base, branch } = active.git
      const ok = await ctx.ui.confirm(
        'Merge branch',
        `Merge ${branch} into ${base}? This does a direct GitHub merge (merge commit).`,
      )
      if (!ok) return
      try {
        // Push the agent's latest commits first so the merge includes them.
        const token = await getGithubToken(pi)
        await pushChanges({ box: active.box, branch, syncConfigured: true }, token)
        const res = await mergeBranch(pi, slug, base, branch)
        if (!res.ok) {
          ctx.ui.notify(`Merge failed: ${res.message}`, 'error')
          return
        }
        ctx.ui.notify(`Merged ${branch} into ${base} ✓`, 'info')
      } catch (err) {
        ctx.ui.notify(`Merge failed: ${errorMessage(err)}`, 'error')
      }
    },
  })

  // Create a pull request for this session's branch. Box has a first-class PR
  // API (gh CLI inside the box), so this actually CREATES the PR; if that
  // fails, fall back to opening GitHub's pre-filled compare page.
  pi.registerCommand('pr', {
    description: "Create a pull request for this session's branch on GitHub",
    handler: async (_args, ctx) => {
      if (!active?.git) {
        ctx.ui.notify('Opening a PR needs a GitHub repo. Launch Pi with --repo.', 'warning')
        return
      }
      const { slug, base, branch } = active.git
      try {
        const token = await getGithubToken(pi)
        await pushChanges({ box: active.box, branch, syncConfigured: true }, token)
        if (token) await refreshGitCredentials(active.box, token)
        const pr = await active.box.git.createPR({ title: `Pi session ${branch}`, base })
        ctx.ui.notify(`PR created: ${pr.url}`, 'info')
        await openUrl(pi, pr.url).catch(() => undefined)
      } catch (err) {
        // Fall back to GitHub's pre-filled "Open a pull request" page.
        const url = prUrl(slug, base, branch)
        try {
          await openUrl(pi, url)
        } catch {
          // Couldn't launch a browser — the URL is still shown below.
        }
        ctx.ui.notify(`Could not create the PR directly (${errorMessage(err)}).\nOpen PR: ${url}`, 'warning')
      }
    },
  })

  // Open this session's branch compare view on GitHub in the browser.
  pi.registerCommand('compare', {
    description: "Open this session's branch compare view on GitHub",
    handler: async (_args, ctx) => {
      if (!active?.git) {
        ctx.ui.notify('No GitHub branch for this session. Launch Pi with --repo.', 'warning')
        return
      }
      const { slug, base, branch } = active.git
      const url = compareUrl(slug, base, branch)
      try {
        await openUrl(pi, url)
      } catch {
        // Couldn't launch a browser — the URL is still shown below.
      }
      ctx.ui.notify(`Compare: ${url}`, 'info')
    },
  })

  // Open this session's branch on GitHub in the browser.
  pi.registerCommand('github', {
    description: "Open this session's branch on GitHub",
    handler: async (_args, ctx) => {
      if (!active?.git) {
        ctx.ui.notify('No GitHub branch for this session. Launch Pi with --repo.', 'warning')
        return
      }
      const url = branchUrl(active.git.slug, active.git.branch)
      try {
        await openUrl(pi, url)
      } catch {
        // Couldn't launch a browser — the URL is still shown below.
      }
      ctx.ui.notify(`GitHub: ${url}`, 'info')
    },
  })

  // --- Lifecycle ---

  pi.on('session_start', async (event, ctx) => {
    if (pi.getFlag('box') !== true) return
    if (active) return // already running (e.g. after reload)

    apiKey = await resolveApiKey(ctx)
    if (!apiKey) {
      ctx.ui.notify('Upstash Box: no API key found — staying local. Set UPSTASH_BOX_API_KEY.', 'error')
      return
    }
    const key = apiKey

    const persisted = ctx.sessionManager.getSessionFile() !== undefined
    const sessionId = ctx.sessionManager.getSessionId()

    // Reap boxes whose session was deleted from the resume menu. Runs in the
    // background so it never slows startup.
    if (persisted) void reapOrphans(key)

    setStatus(ctx, '☁ box · spinning up sandbox…')
    const startedAt = Date.now()

    // Tracked outside the try so the catch can clean up a box that was created
    // but whose later setup (clone, git init, …) failed — otherwise the box
    // would leak (no session entry points at it, so reapOrphans can't
    // attribute it either).
    let created: Box | undefined

    try {
      // Reattach to this session's existing box on resume/reload. A fork
      // always gets a fresh box (branched off the parent below).
      if (persisted && event.reason !== 'fork') {
        const prev = latestSessionEntry(ctx)
        if (prev) {
          try {
            setStatus(ctx, '☁ box · resuming sandbox…')
            const box = await Box.get(prev.boxId, { apiKey: key })
            await ensureStarted(box)
            // Track the repo dir in the SDK so the git namespace (status, push,
            // createPR) targets it. Set ONCE here — never per tool call, which
            // would race (tools bake cwd into the command string instead).
            await box.cd(prev.cwd)
            active = { box, cwd: prev.cwd, git: prev.git }
            ctx.ui.notify(
              `Reattached box · ${shortId(box.id)}${prev.git ? ` · ${prev.git.branch}` : ''}`,
              'info',
            )
            setRunningStatus(ctx, box.id, prev.cwd)
            return
          } catch (err) {
            // Only a truly missing box (404) should spawn a fresh one. A
            // transient failure must NOT fall through — that would orphan the
            // existing box with a duplicate. Rethrow so the outer catch fails
            // cleanly (no box was created yet).
            if (!isNotFound(err)) throw err
            // Box is gone or errored — fall through and create a fresh one.
            // Delete the stale record first: an ERRORED box still exists on
            // the backend and carries this session's sid label, so reapOrphans
            // would see it as owned by a live session and never clean it up.
            // For a genuinely missing box this delete is a harmless no-op.
            await Box.delete({ apiKey: key, boxIds: [prev.boxId] }).catch(() => undefined)
          }
        }
      }

      const runtime = stringFlag(pi.getFlag('runtime'))
      if (runtime && !RUNTIMES.includes(runtime)) {
        throw new Error(`Invalid --runtime '${runtime}'. Valid: ${RUNTIMES.join(', ')}.`)
      }
      const size = stringFlag(pi.getFlag('size'))
      if (size && !SIZES.includes(size)) {
        throw new Error(`Invalid --size '${size}'. Valid: ${SIZES.join(', ')}.`)
      }

      // Resolve the repo first: the git token must be known at Box.create time.
      // The create request itself doesn't install it — the SDK stashes it
      // client-side and transmits it with git.clone, which is what seeds the
      // box's credential store for later pushes.
      let repo = stringFlag(pi.getFlag('repo'))
      let detectedBranch: string | undefined
      if (!repo) {
        const local = await detectLocalRepo(pi, ctx.sessionManager.getCwd())
        if (local) {
          repo = local.url
          detectedBranch = local.branch || undefined
        }
      }
      const slug = repo ? parseRepoSlug(normalizeRepoUrl(repo)) : undefined
      const token = slug ? await getGithubToken(pi) : undefined

      const box = await Box.create({
        apiKey: key,
        name: `pi-${sessionId}`,
        runtime: runtime as Runtime | undefined,
        size: size as BoxSize | undefined,
        // `sid:` carries only the short id — labels are capped at 20 chars.
        // Reattach never relies on labels (the session entry stores the box
        // id); they exist so reapOrphans can attribute boxes to sessions.
        labels: [CREATED_BY_LABEL, `sid:${shortId(sessionId)}`],
        git: {
          token,
          userName: GIT_USER_NAME,
          userEmail: GIT_USER_EMAIL,
        },
      })
      created = box

      // Git identity so the agent's commits (and our init commit) just work.
      // The create-time git.userName/userEmail fields may not be honored by the
      // public create endpoint, so set it explicitly — updateConfig is a
      // first-class Box API.
      await box.git.updateConfig({ userName: GIT_USER_NAME, userEmail: GIT_USER_EMAIL }).catch(() => undefined)

      let cwd: string
      let git: GitTarget | undefined

      if (repo) {
        cwd = joinPath(WORKSPACE_ROOT, repoName(repo))

        if (slug && token) {
          // Each session gets its own GitHub branch pi/<short-session-id>. We
          // create the ref on GitHub first (off the base), then clone that
          // branch so the box has an upstream to push back to (see sync.ts).
          const branch = `pi/${shortId(sessionId)}`
          let base = stringFlag(pi.getFlag('branch'))
          // A fork branches off the parent session's branch.
          if (event.reason === 'fork') {
            const parent = latestSessionEntry(ctx)
            if (parent?.git) base = parent.git.branch
          }
          if (!base) base = detectedBranch // the branch you're on locally
          if (!base) base = await getDefaultBranch(pi, slug)
          if (!base) throw new Error('Could not resolve a base branch on GitHub.')

          const sha = await getBranchSha(pi, slug, base)
          if (!sha) throw new Error(`Base branch '${base}' not found on GitHub.`)
          await ensureBranch(pi, slug, branch, sha)
          // Clone over HTTPS regardless of the origin's format (a detected
          // origin may be SSH, which the token can't authenticate). The Box
          // backend requires a scheme'd URL and clones into
          // /workspace/home/<repo>; the branch is checked out after the clone.
          const cloneUrl = `https://github.com/${slug.owner}/${slug.repo}`
          setStatus(ctx, `☁ box · cloning ${slug.owner}/${slug.repo}…`)
          await box.git.clone({ repo: cloneUrl, branch })
          git = { slug, base, branch }
        } else {
          // Not a github.com repo, or no gh token: clone without a credential
          // (public repos only), no push.
          setStatus(ctx, `☁ box · cloning ${repoName(repo)}…`)
          await box.git.clone({ repo: normalizeRepoUrl(repo), branch: stringFlag(pi.getFlag('branch')) ?? detectedBranch })
          ctx.ui.notify('Upstash Box: GitHub sync disabled (needs `gh auth login` and a github.com repo).', 'warning')
        }
      } else {
        // Not in a git repo: throwaway local repo so the agent can still commit
        // (never pushed). The initial empty commit gives HEAD a valid ref.
        cwd = joinPath(WORKSPACE_ROOT, 'workspace')
        const init = await execCommand(
          box,
          `mkdir -p ${shellQuote(cwd)} && cd ${shellQuote(cwd)} && git init -q -b pi && ` +
            `git commit -q --allow-empty -m "pi: init"`,
        )
        if ((init.exitCode ?? 0) !== 0) {
          throw new Error(`Failed to initialize the workspace (exit ${init.exitCode}): ${init.stderr || init.stdout}`)
        }
      }

      // Track the working dir in the SDK for the git namespace (see reattach).
      await box.cd(cwd)

      active = { box, cwd, git }
      // Record the box so this session can reattach it after a restart.
      if (persisted) {
        const data: SessionEntryData = { boxId: box.id, cwd, git }
        pi.appendEntry(SESSION_ENTRY, data)
      }

      const secs = ((Date.now() - startedAt) / 1000).toFixed(1)
      const branchInfo = git ? ` · ${git.branch}` : ''
      ctx.ui.notify(`Box ready · ${shortId(box.id)}${branchInfo} · ${secs}s`, 'info')
      setRunningStatus(ctx, box.id, cwd)
    } catch (err) {
      active = null
      // Delete the half-created box so it doesn't leak (best-effort).
      if (created) await created.delete().catch(() => undefined)
      setStatus(ctx, undefined)
      ctx.ui.notify(`Upstash Box: failed to start — ${errorMessage(err)}`, 'error')
    }
  })

  // Point the agent's working-directory line at the box and add the
  // commit-not-push guideline. Project context (AGENTS.md/CLAUDE.md) is left to
  // Pi's default loading from the local files. Match the whole line (not a
  // literal host path) so this works regardless of what Pi used as the prompt
  // cwd — avoids a silent no-op if they diverge.
  pi.on('before_agent_start', (event) => {
    if (!active) return
    const cwdLine = `Current working directory: ${active.cwd} (Upstash Box ${shortId(active.box.id)})`
    let systemPrompt = event.systemPrompt.replace(/Current working directory: .*/g, cwdLine)
    systemPrompt +=
      '\n\nThis project is a git repository inside an Upstash Box sandbox. After you finish a unit of work, ' +
      'commit it with git (e.g. `git add -A && git commit -m "..."`). Do not push — pushing is handled automatically.'
    return { systemPrompt }
  })

  // After each agent loop ends, push any commits the agent made to the
  // session's GitHub branch. We don't commit here — the agent commits its own
  // work. The push is serialized and skips a branch with nothing ahead of its
  // remote.
  pi.on('agent_end', async (_event, ctx) => {
    if (!active?.git) return
    try {
      const token = await getGithubToken(pi)
      const res = await pushChanges(
        { box: active.box, branch: active.git.branch, syncConfigured: true },
        token,
      )
      if (res.pushed) {
        ctx.ui.notify(
          `Pushed ${active.git.branch} → ${compareUrl(active.git.slug, active.git.base, active.git.branch)}`,
          'info',
        )
      }
    } catch (err) {
      ctx.ui.notify(`Upstash Box: push failed — ${errorMessage(err)}`, 'warning')
    }
  })

  // On exit, flush a final sync, then KEEP the box (it idle-pauses on its own)
  // so the session can be resumed later. The box is only deleted once its
  // session is deleted from the resume menu — handled by reapOrphans, which we
  // also run here to catch sessions deleted during this run.
  pi.on('session_shutdown', async (event, ctx) => {
    if (!active) return
    // Skip only in-process session handoffs (new/resume/fork) — there the
    // session continues and its box is deliberately kept/reattached. Everything
    // else (quit, reload, or an unlabeled shutdown from Pi builds that emit no
    // reason) is a real teardown and must run cleanup.
    if (event.reason === 'new' || event.reason === 'resume' || event.reason === 'fork') return
    const current = active
    active = null
    setStatus(ctx, undefined)

    const persisted = ctx.sessionManager.getSessionFile() !== undefined
    if (persisted) {
      // Reap boxes whose session no longer exists; this session's own box stays
      // (its session file still exists) and pauses by itself when idle.
      if (apiKey) await reapOrphans(apiKey)
    } else {
      // In-memory session: nothing to resume, so tidy up GitHub and delete the
      // box now. Push any commits made after the last agent_end (e.g. a manual
      // `!git commit`) so work isn't silently lost.
      //
      // The box is only safe to delete once that push has landed: this session
      // can't be resumed, so commits that never reached GitHub would be gone
      // for good (expired gh token, network blip). On a failed push we keep the
      // box and hand the user its id instead.
      let pushed = true
      if (current.git) {
        try {
          const token = await getGithubToken(pi)
          await pushChanges(
            { box: current.box, branch: current.git.branch, syncConfigured: true },
            token,
          )
        } catch (err) {
          pushed = false
          ctx.ui.notify(
            `Upstash Box: final push failed — keeping box ${shortId(current.box.id)} so the commits ` +
              `in it aren't lost. Delete it once you've recovered them. ${errorMessage(err)}`,
            'warning',
          )
        }
        // Branch cleanup is cosmetic and runs only after a good push: delete the
        // throwaway ref if it contributed nothing (HEAD == base on GitHub).
        // Compare on the remote — local ahead-of-remote is 0 right after the
        // push and would wrongly flag branches with real work.
        if (pushed) {
          try {
            const ahead = await getBranchAhead(pi, current.git.slug, current.git.base, current.git.branch)
            if (ahead === 0) await deleteBranch(pi, current.git.slug, current.git.branch)
          } catch {
            // Best-effort; a leaked branch is preferable to lost work.
          }
        }
      }
      if (pushed) {
        try {
          await current.box.delete()
        } catch {
          // Best-effort: reapOrphans catches it on the next launch if this didn't run.
        }
      }
    }
  })
}

/** Most recent box record in this session (for reattach / fork base). */
function latestSessionEntry(ctx: ExtensionContext): SessionEntryData | undefined {
  const entries = ctx.sessionManager.getEntries()
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i] as { type?: string; customType?: string; data?: unknown }
    if (e.type === 'custom' && e.customType === SESSION_ENTRY) {
      return e.data as SessionEntryData
    }
  }
  return undefined
}

/**
 * Ensure a box is usable, resuming it if paused. The coordinator auto-resumes
 * on the next operation anyway; doing it here makes reattach failures explicit
 * and startup snappier. A deleted/errored box is reported as a 404-equivalent
 * so the caller falls through to creating a fresh one.
 */
async function ensureStarted(box: Box): Promise<void> {
  const { status } = await box.getStatus()
  if (status === 'deleted' || status === 'error') {
    // Report as the SDK's 404 shape so isNotFound() treats it as "gone" and
    // the caller falls through to creating a fresh box.
    throw new BoxError(`Box ${shortId(box.id)} is ${status}`, 404)
  }
  if (status === 'paused') {
    await box.resume()
  }
}

/**
 * Delete our boxes whose session no longer exists. This is how a box gets
 * cleaned up when its session is deleted from the resume menu — Pi has no
 * session-deleted hook, so we reconcile against SessionManager.listAll().
 * Labels only carry the SHORT session id (20-char label cap), so a box is
 * reaped only when no live session matches its short id. Best-effort: never
 * throws.
 */
async function reapOrphans(apiKey: string): Promise<void> {
  try {
    const liveShort = new Set((await SessionManager.listAll()).map((s) => shortId(s.id)))
    const boxes = await Box.list({ apiKey, label: CREATED_BY_LABEL })
    const orphans = boxes.filter((b: BoxData) => {
      if (b.status === 'deleted') return false
      // An errored box is unusable — reattach always replaces it — so reap it
      // even when its sid matches a live session (the session runs on the
      // replacement box by then). Backstop for the reattach-time delete.
      if (b.status === 'error') return true
      const sid = b.labels?.find((l) => l.startsWith('sid:'))?.slice('sid:'.length)
      // Only reap boxes we can attribute to a session that no longer exists.
      return Boolean(sid && !liveShort.has(sid))
    })
    if (orphans.length > 0) {
      await Box.delete({ apiKey, boxIds: orphans.map((b) => b.id) }).catch(() => undefined)
    }
  } catch {
    // best-effort reconciliation
  }
}

// --- helpers ---

function setStatus(ctx: ExtensionContext, text: string | undefined): void {
  ctx.ui.setStatus('box', text === undefined ? undefined : ctx.ui.theme.fg('accent', text))
}

function setRunningStatus(ctx: ExtensionContext, id: string, cwd: string): void {
  setStatus(ctx, `☁ box · ${shortId(id)} · running · ${cwd}`)
}

function stringFlag(value: boolean | string | undefined): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Open a URL in the host's default browser (best-effort, cross-platform). */
async function openUrl(pi: ExtensionAPI, url: string): Promise<void> {
  if (process.platform === 'darwin') {
    await pi.exec('open', [url])
  } else if (process.platform === 'win32') {
    await pi.exec('cmd', ['/c', 'start', '', url])
  } else {
    await pi.exec('xdg-open', [url])
  }
}
