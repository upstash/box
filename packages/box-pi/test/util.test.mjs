import { test } from 'node:test'
import assert from 'node:assert/strict'
import { load } from './_load.mjs'

const { shellQuote, normalizeRepoUrl, repoName, shortId, joinPath } = await load('src/util.ts')

test('shellQuote wraps in single quotes', () => {
  assert.equal(shellQuote('abc'), `'abc'`)
  assert.equal(shellQuote('a b'), `'a b'`)
})

test('shellQuote neutralizes single quotes', () => {
  assert.equal(shellQuote(`a'b`), `'a'\\''b'`)
  // $, backticks, globs stay literal inside single quotes
  assert.equal(shellQuote('$HOME `id` *'), `'$HOME \`id\` *'`)
})

test('normalizeRepoUrl passes through full URLs and SSH', () => {
  assert.equal(normalizeRepoUrl('https://github.com/a/b'), 'https://github.com/a/b')
  assert.equal(normalizeRepoUrl('git@github.com:a/b.git'), 'git@github.com:a/b.git')
  assert.equal(normalizeRepoUrl('ssh://git@github.com/a/b'), 'ssh://git@github.com/a/b')
})

test('normalizeRepoUrl adds https:// to bare hosts', () => {
  assert.equal(normalizeRepoUrl('github.com/a/b'), 'https://github.com/a/b')
  assert.equal(normalizeRepoUrl('  github.com/a/b  '), 'https://github.com/a/b')
})

test('normalizeRepoUrl rejects empty input', () => {
  assert.throws(() => normalizeRepoUrl('   '))
})

test('repoName extracts the last path segment', () => {
  assert.equal(repoName('https://github.com/acme/api'), 'api')
  assert.equal(repoName('https://github.com/acme/api.git'), 'api')
  assert.equal(repoName('git@github.com:acme/api.git'), 'api')
  assert.equal(repoName('github.com/acme/api/'), 'api')
  assert.equal(repoName(''), 'repo')
})

test('shortId truncates to 8 chars', () => {
  assert.equal(shortId('0123456789abcdef'), '01234567')
  assert.equal(shortId('abc'), 'abc')
})

test('joinPath joins with exactly one slash', () => {
  assert.equal(joinPath('/workspace/home', 'api'), '/workspace/home/api')
  assert.equal(joinPath('/workspace/home/', '/api'), '/workspace/home/api')
})
