import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import {
  branchUrl,
  compareUrl,
  detectLocalRepo,
  ensureBranch,
  getBranchAhead,
  getGithubToken,
  mergeBranch,
  parseRepoSlug,
  prUrl,
  type RepoSlug,
} from '../src/github.ts'

const slug: RepoSlug = { owner: 'acme', repo: 'api' }

interface StubResponse {
  code?: number
  stdout?: string
  stderr?: string
}

/**
 * A fake ExtensionAPI whose `exec` answers with the first response whose
 * pattern appears in the `<cmd> <args...>` line, and records every call.
 */
function stubPi(responses: [pattern: string, res: StubResponse][]): ExtensionAPI & { calls: string[][] } {
  const calls: string[][] = []
  return {
    calls,
    async exec(cmd: string, args: string[]) {
      calls.push([cmd, ...args])
      const key = `${cmd} ${args.join(' ')}`
      for (const [pattern, res] of responses) {
        if (key.includes(pattern)) return { code: 0, stdout: '', stderr: '', ...res }
      }
      return { code: 1, stdout: '', stderr: 'no stub' }
    },
  } as unknown as ExtensionAPI & { calls: string[][] }
}

describe('parseRepoSlug', () => {
  it('parses an https URL', () => {
    expect(parseRepoSlug('https://github.com/acme/api')).toEqual(slug)
  })

  it('strips .git and a trailing slash', () => {
    expect(parseRepoSlug('https://github.com/acme/api.git')).toEqual(slug)
    expect(parseRepoSlug('https://github.com/acme/api/')).toEqual(slug)
  })

  it('parses scp-style SSH', () => {
    expect(parseRepoSlug('git@github.com:acme/api.git')).toEqual(slug)
  })

  it('parses a bare host', () => {
    expect(parseRepoSlug('github.com/acme/api')).toEqual(slug)
  })

  it('rejects non-github hosts', () => {
    expect(parseRepoSlug('https://gitlab.com/acme/api')).toBeUndefined()
    expect(parseRepoSlug('git@gitlab.com:acme/api.git')).toBeUndefined()
  })

  it('rejects host spoofing via userinfo', () => {
    expect(parseRepoSlug('https://evil.com/@github.com/acme/api')).toBeUndefined()
  })

  it('rejects tree/blob subpaths', () => {
    expect(parseRepoSlug('https://github.com/acme/api/tree/main')).toBeUndefined()
    expect(parseRepoSlug('https://github.com/acme')).toBeUndefined()
  })
})

describe('URL builders', () => {
  it('builds compare, branch, and PR URLs', () => {
    expect(compareUrl(slug, 'main', 'pi/abc')).toBe('https://github.com/acme/api/compare/main...pi%2Fabc')
    expect(branchUrl(slug, 'pi/abc')).toBe('https://github.com/acme/api/tree/pi/abc')
    expect(prUrl(slug, 'main', 'pi/abc')).toBe('https://github.com/acme/api/compare/main...pi%2Fabc?expand=1')
  })
})

describe('detectLocalRepo', () => {
  it('returns origin + branch', async () => {
    const pi = stubPi([
      ['remote get-url origin', { stdout: 'git@github.com:acme/api.git\n' }],
      ['rev-parse --abbrev-ref HEAD', { stdout: 'main\n' }],
    ])
    await expect(detectLocalRepo(pi, '/proj')).resolves.toEqual({
      url: 'git@github.com:acme/api.git',
      branch: 'main',
    })
  })

  it('reports a detached HEAD as an empty branch', async () => {
    const pi = stubPi([
      ['remote get-url origin', { stdout: 'https://github.com/acme/api\n' }],
      ['rev-parse --abbrev-ref HEAD', { stdout: 'HEAD\n' }],
    ])
    await expect(detectLocalRepo(pi, '/proj')).resolves.toEqual({
      url: 'https://github.com/acme/api',
      branch: '',
    })
  })

  it('returns undefined outside a repo', async () => {
    await expect(detectLocalRepo(stubPi([]), '/proj')).resolves.toBeUndefined()
  })
})

describe('getGithubToken', () => {
  it('returns the trimmed token, or undefined', async () => {
    await expect(getGithubToken(stubPi([['auth token', { stdout: 'gho_x\n' }]]))).resolves.toBe('gho_x')
    await expect(getGithubToken(stubPi([]))).resolves.toBeUndefined()
  })
})

describe('ensureBranch', () => {
  it('treats already-exists as success', async () => {
    const pi = stubPi([['git/refs', { code: 1, stderr: 'Reference already exists (HTTP 422)' }]])
    await expect(ensureBranch(pi, slug, 'pi/abc', 'deadbeef')).resolves.toBeUndefined()
  })

  it('throws on real failures', async () => {
    const pi = stubPi([['git/refs', { code: 1, stderr: 'boom' }]])
    await expect(ensureBranch(pi, slug, 'pi/abc', 'deadbeef')).rejects.toThrow(/boom/)
  })
})

describe('mergeBranch', () => {
  it('reports a successful merge', async () => {
    await expect(mergeBranch(stubPi([['merges', {}]]), slug, 'main', 'pi/a')).resolves.toEqual({
      ok: true,
      message: 'merged',
    })
  })

  it('treats nothing-to-merge as success', async () => {
    const pi = stubPi([['merges', { code: 1, stderr: 'nothing to merge' }]])
    await expect(mergeBranch(pi, slug, 'main', 'pi/a')).resolves.toEqual({
      ok: true,
      message: 'already up to date',
    })
  })

  it('reports a conflict as a failure', async () => {
    const pi = stubPi([['merges', { code: 1, stderr: 'conflict' }]])
    await expect(mergeBranch(pi, slug, 'main', 'pi/a')).resolves.toMatchObject({ ok: false })
  })
})

describe('getBranchAhead', () => {
  it('parses the count, and returns undefined on garbage or failure', async () => {
    await expect(getBranchAhead(stubPi([['compare', { stdout: '3' }]]), slug, 'main', 'pi/a')).resolves.toBe(3)
    await expect(
      getBranchAhead(stubPi([['compare', { stdout: 'nope' }]]), slug, 'main', 'pi/a'),
    ).resolves.toBeUndefined()
    await expect(getBranchAhead(stubPi([]), slug, 'main', 'pi/a')).resolves.toBeUndefined()
  })
})
