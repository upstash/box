import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fakeBox, fakeRun, load } from './_load.mjs'

const { refreshGitCredentials, getAheadCount, pushChanges } = await load('src/sync.ts')

function gitBox({ ahead = '1', onPush } = {}) {
  const box = fakeBox({ onExec: () => fakeRun() })
  box.calls.gitExec = []
  box.calls.push = []
  box.git.exec = async ({ args }) => {
    box.calls.gitExec.push(args)
    if (ahead instanceof Error) throw ahead
    return { output: `${ahead}\n` }
  }
  box.git.push = async (opts) => {
    box.calls.push.push(opts)
    if (onPush) return onPush(opts)
  }
  return box
}

// --- refreshGitCredentials ---

test('refreshGitCredentials seeds the credential store and gh config', async () => {
  const box = fakeBox({ onExec: () => fakeRun() })
  await refreshGitCredentials(box, 'gho_secret')
  assert.equal(box.calls.exec.length, 1)
  const cmd = box.calls.exec[0]
  assert.match(cmd, /credential\.helper store/)
  assert.match(cmd, /git credential approve/)
  assert.match(cmd, /hosts\.yml/)
  assert.match(cmd, /'gho_secret'/) // token is shell-quoted
})

test('refreshGitCredentials quotes hostile tokens', async () => {
  const box = fakeBox({ onExec: () => fakeRun() })
  await refreshGitCredentials(box, `x'; rm -rf / #`)
  assert.match(box.calls.exec[0], /'x'\\''; rm -rf \/ #'/)
})

test('refreshGitCredentials throws on nonzero exit', async () => {
  const box = fakeBox({ onExec: () => fakeRun({ exitCode: 1 }) })
  await assert.rejects(() => refreshGitCredentials(box, 't'), /Failed to refresh GitHub credentials/)
})

// --- getAheadCount ---

test('getAheadCount runs rev-list against origin/<branch>', async () => {
  const box = gitBox({ ahead: '3' })
  assert.equal(await getAheadCount(box, 'pi/abc'), 3)
  assert.deepEqual(box.calls.gitExec[0], ['rev-list', '--count', 'origin/pi/abc..HEAD'])
})

test('getAheadCount returns undefined on garbage or errors', async () => {
  assert.equal(await getAheadCount(gitBox({ ahead: 'fatal: bad revision' }), 'b'), undefined)
  assert.equal(await getAheadCount(gitBox({ ahead: new Error('boom') }), 'b'), undefined)
})

// --- pushChanges ---

const target = (box) => ({ box, branch: 'pi/abc', syncConfigured: true })

test('pushChanges: sync off is a no-op', async () => {
  const box = gitBox()
  const res = await pushChanges({ ...target(box), syncConfigured: false }, 'tok')
  assert.deepEqual(res, { pushed: false })
  assert.equal(box.calls.push.length, 0)
})

test('pushChanges: configured but missing token is a real failure', async () => {
  await assert.rejects(() => pushChanges(target(gitBox()), undefined), /gh auth login/)
})

test('pushChanges: nothing ahead skips the push and credential refresh', async () => {
  const box = gitBox({ ahead: '0' })
  const res = await pushChanges(target(box), 'tok')
  assert.deepEqual(res, { pushed: false })
  assert.equal(box.calls.push.length, 0)
  assert.equal(box.calls.exec.length, 0) // no credential refresh either
})

test('pushChanges: ahead pushes with a fresh credential', async () => {
  const box = gitBox({ ahead: '2' })
  const res = await pushChanges(target(box), 'tok')
  assert.deepEqual(res, { pushed: true })
  assert.deepEqual(box.calls.push, [{ branch: 'pi/abc' }])
  assert.match(box.calls.exec[0], /git credential approve/) // refreshed before push
})

test('pushChanges: unknown ahead count still pushes (never drop work)', async () => {
  const box = gitBox({ ahead: new Error('no upstream yet') })
  const res = await pushChanges(target(box), 'tok')
  assert.deepEqual(res, { pushed: true })
  assert.equal(box.calls.push.length, 1)
})

test('pushChanges serializes concurrent pushes', async () => {
  const order = []
  const slow = gitBox({
    onPush: () =>
      new Promise((resolve) =>
        setTimeout(() => {
          order.push('first')
          resolve()
        }, 30),
      ),
  })
  const fast = gitBox({
    onPush: () => {
      order.push('second')
    },
  })
  await Promise.all([pushChanges(target(slow), 'tok'), pushChanges(target(fast), 'tok')])
  assert.deepEqual(order, ['first', 'second'])
})

test('pushChanges: a failed push does not poison the queue', async () => {
  const failing = gitBox({
    onPush: () => {
      throw new Error('push exploded')
    },
  })
  await assert.rejects(() => pushChanges(target(failing), 'tok'), /push exploded/)
  const ok = gitBox()
  assert.deepEqual(await pushChanges(target(ok), 'tok'), { pushed: true })
})
