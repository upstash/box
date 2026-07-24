import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fakeBox, fakeRun, fakeStream, load } from './_load.mjs'

const { BoxError } = await import('@upstash/box')
const { BoxUnavailableError, isNotFound, withRecovery, withCwd, withTimeout, execCommand, execStreamCollect } =
  await load('src/box.ts')

// --- isNotFound ---

test('isNotFound matches only BoxError 404', () => {
  assert.equal(isNotFound(new BoxError('gone', 404)), true)
  assert.equal(isNotFound(new BoxError('server', 500)), false)
  assert.equal(isNotFound(new Error('404')), false)
})

// --- withRecovery ---

test('withRecovery passes through success', async () => {
  const box = fakeBox()
  assert.equal(await withRecovery(box, async () => 42), 42)
  assert.equal(box.calls.statusChecks, 0)
})

test('withRecovery maps a 404 op error to BoxUnavailableError', async () => {
  const box = fakeBox()
  await assert.rejects(
    () =>
      withRecovery(box, async () => {
        throw new BoxError('not found', 404)
      }),
    BoxUnavailableError,
  )
})

test('withRecovery resumes a paused box and retries once', async () => {
  const box = fakeBox({ status: 'paused' })
  let attempts = 0
  const result = await withRecovery(box, async () => {
    attempts++
    if (attempts === 1) throw new BoxError('box is paused', 409)
    return 'ok'
  })
  assert.equal(result, 'ok')
  assert.equal(attempts, 2)
  assert.equal(box.calls.resume, 1)
})

test('withRecovery rethrows genuine op errors when the box is healthy', async () => {
  const box = fakeBox({ status: 'running' })
  await assert.rejects(
    () =>
      withRecovery(box, async () => {
        throw new Error('command failed')
      }),
    /command failed/,
  )
  assert.equal(box.calls.resume, 0)
})

test('withRecovery: status 404 means the box is gone', async () => {
  const box = fakeBox()
  box.getStatus = async () => {
    throw new BoxError('gone', 404)
  }
  await assert.rejects(
    () =>
      withRecovery(box, async () => {
        throw new Error('op failed')
      }),
    BoxUnavailableError,
  )
})

test('withRecovery: transient status failure surfaces the ORIGINAL op error', async () => {
  const box = fakeBox()
  box.getStatus = async () => {
    throw new Error('network blip')
  }
  await assert.rejects(
    () =>
      withRecovery(box, async () => {
        throw new Error('the real op error')
      }),
    /the real op error/,
  )
})

test('withRecovery: deleted/error status maps to BoxUnavailableError', async () => {
  for (const status of ['deleted', 'error']) {
    const box = fakeBox({ status })
    await assert.rejects(
      () =>
        withRecovery(box, async () => {
          throw new Error('op failed')
        }),
      BoxUnavailableError,
    )
  }
})

test('withRecovery: failed resume maps to BoxUnavailableError', async () => {
  const box = fakeBox({ status: 'paused' })
  box.resume = async () => {
    throw new BoxError('cannot resume', 500)
  }
  await assert.rejects(
    () =>
      withRecovery(box, async () => {
        throw new Error('op failed')
      }),
    BoxUnavailableError,
  )
})

// --- command builders ---

test('withCwd prefixes cd with a quoted path and subshell', () => {
  const cmd = withCwd('echo hi', "/workspace/home/my repo's dir")
  assert.match(cmd, /^cd '\/workspace\/home\/my repo'\\''s dir' && \(\n/)
  assert.match(cmd, /echo hi\n\)$/)
})

test('withTimeout wraps in coreutils timeout with ceiled seconds', () => {
  assert.equal(withTimeout('echo hi', undefined), 'echo hi')
  assert.equal(withTimeout('echo hi', 0), 'echo hi')
  assert.equal(withTimeout('echo hi', NaN), 'echo hi')
  assert.equal(withTimeout('echo hi', 1500), `timeout 2 sh -c 'echo hi'`)
  assert.equal(withTimeout('echo hi', 500), `timeout 1 sh -c 'echo hi'`)
})

// --- execCommand / execStreamCollect ---

test('execCommand applies cwd prefix and recovers', async () => {
  const box = fakeBox({ onExec: (cmd) => fakeRun({ stdout: cmd }) })
  const res = await execCommand(box, 'pwd', '/workspace/home/api')
  assert.match(res.stdout, /^cd '\/workspace\/home\/api' && \(/)
  const bare = await execCommand(box, 'pwd')
  assert.equal(bare.stdout, 'pwd')
})

test('execStreamCollect forwards output chunks and returns exit code', async () => {
  const box = fakeBox({
    onStream: () =>
      fakeStream([
        { type: 'output', data: 'hello ' },
        { type: 'output', data: 'world' },
        { type: 'exit', exitCode: 3, cpuNs: 1 },
      ]),
  })
  const chunks = []
  const { exitCode } = await execStreamCollect(box, 'cmd', '/w', (d) => chunks.push(d))
  assert.equal(chunks.join(''), 'hello world')
  assert.equal(exitCode, 3)
  assert.match(box.calls.stream[0], /^cd '\/w' && \(/)
})

test('execStreamCollect falls back to run.exitCode without an exit chunk', async () => {
  const box = fakeBox({ onStream: () => fakeStream([{ type: 'output', data: 'x' }], { exitCode: 0 }) })
  const { exitCode } = await execStreamCollect(box, 'cmd', undefined, () => {})
  assert.equal(exitCode, 0)
})

test('execStreamCollect aborts between chunks', async () => {
  const ac = new AbortController()
  const box = fakeBox({
    onStream: () =>
      fakeStream([
        { type: 'output', data: 'first' },
        { type: 'output', data: 'second' },
      ]),
  })
  await assert.rejects(
    () =>
      execStreamCollect(box, 'cmd', undefined, () => ac.abort(), ac.signal),
    /aborted/,
  )
})
