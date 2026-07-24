import { test } from 'node:test'
import assert from 'node:assert/strict'
import { load } from './_load.mjs'

const {
  parseRepoSlug,
  compareUrl,
  branchUrl,
  prUrl,
  detectLocalRepo,
  getGithubToken,
  ensureBranch,
  mergeBranch,
  getBranchAhead,
} = await load('src/github.ts')

// --- parseRepoSlug ---

test('parseRepoSlug: https URL', () => {
  assert.deepEqual(parseRepoSlug('https://github.com/acme/api'), { owner: 'acme', repo: 'api' })
})

test('parseRepoSlug: strips .git and trailing slash', () => {
  assert.deepEqual(parseRepoSlug('https://github.com/acme/api.git'), { owner: 'acme', repo: 'api' })
  assert.deepEqual(parseRepoSlug('https://github.com/acme/api/'), { owner: 'acme', repo: 'api' })
})

test('parseRepoSlug: scp-style SSH', () => {
  assert.deepEqual(parseRepoSlug('git@github.com:acme/api.git'), { owner: 'acme', repo: 'api' })
})

test('parseRepoSlug: bare host', () => {
  assert.deepEqual(parseRepoSlug('github.com/acme/api'), { owner: 'acme', repo: 'api' })
})

test('parseRepoSlug: rejects non-github hosts', () => {
  assert.equal(parseRepoSlug('https://gitlab.com/acme/api'), undefined)
  assert.equal(parseRepoSlug('git@gitlab.com:acme/api.git'), undefined)
})

test('parseRepoSlug: rejects host spoofing via userinfo', () => {
  assert.equal(parseRepoSlug('https://evil.com/@github.com/acme/api'), undefined)
})

test('parseRepoSlug: rejects tree/blob subpaths', () => {
  assert.equal(parseRepoSlug('https://github.com/acme/api/tree/main'), undefined)
  assert.equal(parseRepoSlug('https://github.com/acme'), undefined)
})

// --- URL builders ---

const slug = { owner: 'acme', repo: 'api' }

test('compareUrl / branchUrl / prUrl', () => {
  assert.equal(compareUrl(slug, 'main', 'pi/abc'), 'https://github.com/acme/api/compare/main...pi%2Fabc')
  assert.equal(branchUrl(slug, 'pi/abc'), 'https://github.com/acme/api/tree/pi/abc')
  assert.equal(prUrl(slug, 'main', 'pi/abc'), 'https://github.com/acme/api/compare/main...pi%2Fabc?expand=1')
})

// --- gh-backed helpers (stubbed pi.exec) ---

function stubPi(responses) {
  const calls = []
  return {
    calls,
    async exec(cmd, args) {
      calls.push([cmd, ...args])
      const key = `${cmd} ${args.join(' ')}`
      for (const [pattern, res] of responses) {
        if (key.includes(pattern)) return { code: 0, stdout: '', stderr: '', ...res }
      }
      return { code: 1, stdout: '', stderr: 'no stub' }
    },
  }
}

test('detectLocalRepo returns origin + branch', async () => {
  const pi = stubPi([
    ['remote get-url origin', { stdout: 'git@github.com:acme/api.git\n' }],
    ['rev-parse --abbrev-ref HEAD', { stdout: 'main\n' }],
  ])
  assert.deepEqual(await detectLocalRepo(pi, '/proj'), { url: 'git@github.com:acme/api.git', branch: 'main' })
})

test('detectLocalRepo: detached HEAD reported as empty branch', async () => {
  const pi = stubPi([
    ['remote get-url origin', { stdout: 'https://github.com/acme/api\n' }],
    ['rev-parse --abbrev-ref HEAD', { stdout: 'HEAD\n' }],
  ])
  assert.deepEqual(await detectLocalRepo(pi, '/proj'), { url: 'https://github.com/acme/api', branch: '' })
})

test('detectLocalRepo: not a repo -> undefined', async () => {
  const pi = stubPi([])
  assert.equal(await detectLocalRepo(pi, '/proj'), undefined)
})

test('getGithubToken returns trimmed token or undefined', async () => {
  assert.equal(await getGithubToken(stubPi([['auth token', { stdout: 'gho_x\n' }]])), 'gho_x')
  assert.equal(await getGithubToken(stubPi([])), undefined)
})

test('ensureBranch treats already-exists as success', async () => {
  const pi = stubPi([['git/refs', { code: 1, stderr: 'Reference already exists (HTTP 422)' }]])
  await ensureBranch(pi, slug, 'pi/abc', 'deadbeef') // must not throw
})

test('ensureBranch throws on real failures', async () => {
  const pi = stubPi([['git/refs', { code: 1, stderr: 'boom' }]])
  await assert.rejects(() => ensureBranch(pi, slug, 'pi/abc', 'deadbeef'), /boom/)
})

test('mergeBranch: ok, already-merged, and failure', async () => {
  assert.deepEqual(await mergeBranch(stubPi([['merges', {}]]), slug, 'main', 'pi/a'), {
    ok: true,
    message: 'merged',
  })
  assert.deepEqual(
    await mergeBranch(stubPi([['merges', { code: 1, stderr: 'nothing to merge' }]]), slug, 'main', 'pi/a'),
    { ok: true, message: 'already up to date' },
  )
  const failed = await mergeBranch(stubPi([['merges', { code: 1, stderr: 'conflict' }]]), slug, 'main', 'pi/a')
  assert.equal(failed.ok, false)
})

test('getBranchAhead parses the count, undefined on garbage', async () => {
  assert.equal(await getBranchAhead(stubPi([['compare', { stdout: '3' }]]), slug, 'main', 'pi/a'), 3)
  assert.equal(await getBranchAhead(stubPi([['compare', { stdout: 'nope' }]]), slug, 'main', 'pi/a'), undefined)
  assert.equal(await getBranchAhead(stubPi([]), slug, 'main', 'pi/a'), undefined)
})
