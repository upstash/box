import { describe, expect, it } from 'vitest'
import { runRemoteFind } from '../src/find-tool.ts'
import { runRemoteGrep } from '../src/grep-tool.ts'
import { fakeBox, fakeRun } from './helpers.ts'

const CWD = '/workspace/home/api'

describe('find', () => {
  it('builds an rg --files command with the glob and limit', async () => {
    const box = fakeBox({ onExec: () => fakeRun({ stdout: './src/a.ts\n./src/b.ts\n' }) })
    const res = await runRemoteFind(box, CWD, { pattern: '*.ts', limit: 50 })
    const cmd = box.calls.exec[0]
    expect(cmd).toMatch(/rg --files --hidden/)
    expect(cmd).toMatch(/'\*\.ts'/)
    expect(cmd).toMatch(/head -n 50/)
    expect(cmd).toMatch(new RegExp(`^cd '${CWD}'`)) // runs in the box cwd
    expect(res.content[0].text).toBe('src/a.ts\nsrc/b.ts') // leading ./ stripped
  })

  it('matches a path glob at any depth (**/ prefix)', async () => {
    const box = fakeBox({ onExec: () => fakeRun({ stdout: '' }) })
    await runRemoteFind(box, CWD, { pattern: 'src/*.ts' })
    expect(box.calls.exec[0]).toMatch(/'\*\*\/src\/\*\.ts'/)
  })

  it('joins a relative search path to cwd and keeps an absolute one', async () => {
    const rel = fakeBox({ onExec: () => fakeRun({ stdout: '' }) })
    await runRemoteFind(rel, CWD, { pattern: '*.md', path: 'docs' })
    expect(rel.calls.exec[0]).toMatch(new RegExp(`^cd '${CWD}/docs'`))

    const abs = fakeBox({ onExec: () => fakeRun({ stdout: '' }) })
    await runRemoteFind(abs, CWD, { pattern: '*.md', path: '/tmp' })
    expect(abs.calls.exec[0]).toMatch(/^cd '\/tmp'/)
  })

  it('falls back to the default limit when it is malformed', async () => {
    const box = fakeBox({ onExec: () => fakeRun({ stdout: '' }) })
    await runRemoteFind(box, CWD, { pattern: '*.ts', limit: Number.NaN })
    expect(box.calls.exec[0]).toMatch(/head -n 1000/)
  })

  it('reports no results and propagates errors', async () => {
    const empty = fakeBox({ onExec: () => fakeRun({ stdout: '' }) })
    const res = await runRemoteFind(empty, CWD, { pattern: '*.zig' })
    expect(res.content[0].text).toBe('No files found matching pattern')

    const failing = fakeBox({ onExec: () => fakeRun({ exitCode: 2 }) })
    await expect(runRemoteFind(failing, CWD, { pattern: '*' })).rejects.toThrow(/find failed/)
  })
})

describe('grep', () => {
  it('builds an rg command with flags and a quoted pattern', async () => {
    const box = fakeBox({ onExec: () => fakeRun({ stdout: 'src/a.ts:3:const x = 1\n' }) })
    const res = await runRemoteGrep(box, CWD, {
      pattern: 'const x',
      ignoreCase: true,
      literal: true,
      context: 2,
      glob: '*.ts',
      limit: 10,
    })
    const cmd = box.calls.exec[0]
    expect(cmd).toMatch(/rg --line-number --no-heading --color=never --hidden/)
    expect(cmd).toMatch(/--ignore-case/)
    expect(cmd).toMatch(/--fixed-strings/)
    expect(cmd).toMatch(/--context 2/)
    expect(cmd).toMatch(/--glob '\*\.ts'/)
    expect(cmd).toMatch(/'const x'/)
    expect(cmd).toMatch(/head -n 10/)
    expect(res.content[0].text).toBe('src/a.ts:3:const x = 1')
  })

  it('shell-quotes a hostile pattern instead of executing it', async () => {
    const box = fakeBox({ onExec: () => fakeRun({ stdout: '' }) })
    await runRemoteGrep(box, CWD, { pattern: `'; rm -rf / #` })
    expect(box.calls.exec[0]).toMatch(/''\\''; rm -rf \/ #'/)
  })

  it('sanitizes Infinity context and limit', async () => {
    const box = fakeBox({ onExec: () => fakeRun({ stdout: '' }) })
    await runRemoteGrep(box, CWD, {
      pattern: 'x',
      context: Number.POSITIVE_INFINITY,
      limit: Number.POSITIVE_INFINITY,
    })
    const cmd = box.calls.exec[0]
    expect(cmd).not.toMatch(/Infinity/)
    expect(cmd).toMatch(/head -n 100/)
  })

  it('reports no matches and propagates errors', async () => {
    const empty = fakeBox({ onExec: () => fakeRun({ stdout: '' }) })
    const res = await runRemoteGrep(empty, CWD, { pattern: 'nope' })
    expect(res.content[0].text).toMatch(/No matches found/)

    const failing = fakeBox({ onExec: () => fakeRun({ exitCode: 2 }) })
    await expect(runRemoteGrep(failing, CWD, { pattern: 'x' })).rejects.toThrow(/grep failed/)
  })
})
