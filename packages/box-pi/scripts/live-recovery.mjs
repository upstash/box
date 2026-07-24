/**
 * Copyright Upstash, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Live end-to-end: pause/resume recovery and fail-closed behavior.
 *
 *  1. Ops keep working after the box is paused out-of-band (the coordinator
 *     auto-resumes, withRecovery covers stale-state edges).
 *  2. Ops against a DELETED box fail with BoxUnavailableError — loudly, never
 *     silently.
 *
 * Needs UPSTASH_BOX_API_KEY.
 */

import { assert, createTestBox, load } from './_live.mjs'

const { createBashOps } = await load('src/ops.ts')
const { BoxUnavailableError, execCommand } = await load('src/box.ts')

const WORKDIR = '/workspace/home'

const { box, cleanup } = await createTestBox('pi-live-recovery')
let deleted = false
try {
  const bash = createBashOps(box)
  const run = async (cmd) => {
    let out = ''
    const res = await bash.exec(cmd, WORKDIR, { onData: (b) => (out += b.toString()), signal: undefined, timeout: undefined })
    return { ...res, out }
  }

  // Sanity: box works, and state survives across calls via the filesystem.
  const first = await run('echo alive > /workspace/home/state.txt && cat /workspace/home/state.txt')
  assert(first.exitCode === 0 && first.out.includes('alive'), 'initial exec works')
  console.log('✓ initial exec')

  // Pause out-of-band, then exec again — must transparently come back.
  console.log('pausing box…')
  await box.pause()
  const after = await run('cat /workspace/home/state.txt')
  assert(after.exitCode === 0, `exec after pause succeeds (got exit ${after.exitCode})`)
  assert(after.out.includes('alive'), `filesystem preserved across pause (got: ${after.out})`)
  console.log('✓ exec after pause auto-resumes with filesystem intact')

  // Delete the box, then exec — must fail closed with a clear error.
  console.log('deleting box…')
  await box.delete()
  deleted = true
  let failedClosed = false
  try {
    await execCommand(box, 'echo should-not-run')
  } catch (err) {
    failedClosed = err instanceof BoxUnavailableError
    if (!failedClosed) console.error(`unexpected error type: ${err?.name}: ${err?.message}`)
  }
  assert(failedClosed, 'exec on a deleted box throws BoxUnavailableError')
  console.log('✓ deleted box fails closed with BoxUnavailableError')

  console.log('\nlive-recovery passed.')
} finally {
  if (!deleted) await cleanup()
}
