import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fakeBox, fakeRun, load } from './_load.mjs'

const { runRemoteFind } = await load('src/find-tool.ts')
const { runRemoteGrep } = await load('src/grep-tool.ts')

const CWD = '/workspace/home/api'

// --- find ---

test('find builds an rg --files command with the glob and limit', async () => {
  const box = fakeBox({ onExec: () => fakeRun({ stdout: './src/a.ts\n./src/b.ts\n' }) })
  const res = await runRemoteFind(box, CWD, { pattern: '*.ts', limit: 50 })
  const cmd = box.calls.exec[0]
  assert.match(cmd, /rg --files --hidden/)
  assert.match(cmd, /'\*\.ts'/)
  assert.match(cmd, /head -n 50/)
  assert.match(cmd, new RegExp(`^cd '${CWD}'`)) // runs in the box cwd
  assert.equal(res.content[0].text, 'src/a.ts\nsrc/b.ts') // leading ./ stripped
})

test('find: path glob is matched at any depth (**/ prefix)', async () => {
  const box = fakeBox({ onExec: () => fakeRun({ stdout: '' }) })
  await runRemoteFind(box, CWD, { pattern: 'src/*.ts' })
  assert.match(box.calls.exec[0], /'\*\*\/src\/\*\.ts'/)
})

test('find: relative search path is joined to cwd, absolute kept', async () => {
  const rel = fakeBox({ onExec: () => fakeRun({ stdout: '' }) })
  await runRemoteFind(rel, CWD, { pattern: '*.md', path: 'docs' })
  assert.match(rel.calls.exec[0], new RegExp(`^cd '${CWD}/docs'`))

  const abs = fakeBox({ onExec: () => fakeRun({ stdout: '' }) })
  await runRemoteFind(abs, CWD, { pattern: '*.md', path: '/tmp' })
  assert.match(abs.calls.exec[0], /^cd '\/tmp'/)
})

test('find: malformed limit falls back to the default', async () => {
  const box = fakeBox({ onExec: () => fakeRun({ stdout: '' }) })
  await runRemoteFind(box, CWD, { pattern: '*.ts', limit: Number.NaN })
  assert.match(box.calls.exec[0], /head -n 1000/)
})

test('find: no results message and error propagation', async () => {
  const empty = fakeBox({ onExec: () => fakeRun({ stdout: '' }) })
  const res = await runRemoteFind(empty, CWD, { pattern: '*.zig' })
  assert.equal(res.content[0].text, 'No files found matching pattern')

  const failing = fakeBox({ onExec: () => fakeRun({ exitCode: 2 }) })
  await assert.rejects(() => runRemoteFind(failing, CWD, { pattern: '*' }), /find failed/)
})

// --- grep ---

test('grep builds an rg command with flags and quoted pattern', async () => {
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
  assert.match(cmd, /rg --line-number --no-heading --color=never --hidden/)
  assert.match(cmd, /--ignore-case/)
  assert.match(cmd, /--fixed-strings/)
  assert.match(cmd, /--context 2/)
  assert.match(cmd, /--glob '\*\.ts'/)
  assert.match(cmd, /'const x'/)
  assert.match(cmd, /head -n 10/)
  assert.equal(res.content[0].text, 'src/a.ts:3:const x = 1')
})

test('grep: hostile pattern is shell-quoted, not executed', async () => {
  const box = fakeBox({ onExec: () => fakeRun({ stdout: '' }) })
  await runRemoteGrep(box, CWD, { pattern: `'; rm -rf / #` })
  assert.match(box.calls.exec[0], /''\\''; rm -rf \/ #'/)
})

test('grep: Infinity context/limit are sanitized', async () => {
  const box = fakeBox({ onExec: () => fakeRun({ stdout: '' }) })
  await runRemoteGrep(box, CWD, { pattern: 'x', context: Number.POSITIVE_INFINITY, limit: Number.POSITIVE_INFINITY })
  const cmd = box.calls.exec[0]
  assert.doesNotMatch(cmd, /Infinity/)
  assert.match(cmd, /head -n 100/)
})

test('grep: no matches message and error propagation', async () => {
  const empty = fakeBox({ onExec: () => fakeRun({ stdout: '' }) })
  const res = await runRemoteGrep(empty, CWD, { pattern: 'nope' })
  assert.match(res.content[0].text, /No matches found/)

  const failing = fakeBox({ onExec: () => fakeRun({ exitCode: 2 }) })
  await assert.rejects(() => runRemoteGrep(failing, CWD, { pattern: 'x' }), /grep failed/)
})
