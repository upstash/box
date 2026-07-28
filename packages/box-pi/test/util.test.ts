import { describe, expect, it } from 'vitest'
import { joinPath, normalizeRepoUrl, repoName, shellQuote, shortId } from '../src/util.ts'

describe('shellQuote', () => {
  it('wraps in single quotes', () => {
    expect(shellQuote('abc')).toBe(`'abc'`)
    expect(shellQuote('a b')).toBe(`'a b'`)
  })

  it('neutralizes single quotes', () => {
    expect(shellQuote(`a'b`)).toBe(`'a'\\''b'`)
    // $, backticks, globs stay literal inside single quotes
    expect(shellQuote('$HOME `id` *')).toBe(`'$HOME \`id\` *'`)
  })
})

describe('normalizeRepoUrl', () => {
  it('passes through full URLs and SSH', () => {
    expect(normalizeRepoUrl('https://github.com/a/b')).toBe('https://github.com/a/b')
    expect(normalizeRepoUrl('git@github.com:a/b.git')).toBe('git@github.com:a/b.git')
    expect(normalizeRepoUrl('ssh://git@github.com/a/b')).toBe('ssh://git@github.com/a/b')
  })

  it('adds https:// to bare hosts', () => {
    expect(normalizeRepoUrl('github.com/a/b')).toBe('https://github.com/a/b')
    expect(normalizeRepoUrl('  github.com/a/b  ')).toBe('https://github.com/a/b')
  })

  it('rejects empty input', () => {
    expect(() => normalizeRepoUrl('   ')).toThrow()
  })
})

describe('repoName', () => {
  it('extracts the last path segment', () => {
    expect(repoName('https://github.com/acme/api')).toBe('api')
    expect(repoName('https://github.com/acme/api.git')).toBe('api')
    expect(repoName('git@github.com:acme/api.git')).toBe('api')
    expect(repoName('github.com/acme/api/')).toBe('api')
    expect(repoName('')).toBe('repo')
  })
})

describe('shortId', () => {
  it('truncates to 8 chars', () => {
    expect(shortId('0123456789abcdef')).toBe('01234567')
    expect(shortId('abc')).toBe('abc')
  })
})

describe('joinPath', () => {
  it('joins with exactly one slash', () => {
    expect(joinPath('/workspace/home', 'api')).toBe('/workspace/home/api')
    expect(joinPath('/workspace/home/', '/api')).toBe('/workspace/home/api')
  })
})
