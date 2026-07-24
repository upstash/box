/**
 * Copyright Upstash, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Live end-to-end: backgrounded processes and timeouts.
 *
 *  1. `sleep 20 & echo started` must return as soon as the FOREGROUND finishes
 *     (the backgroundSafe wrapper), not after 20s.
 *  2. A command exceeding Pi's timeout is killed in-shell by coreutils
 *     `timeout` and surfaces exit code 124.
 *
 * Needs UPSTASH_BOX_API_KEY.
 */

import { assert, createTestBox, load } from './_live.mjs'

const { createBashOps } = await load('src/ops.ts')

const WORKDIR = '/workspace/home'

const { box, cleanup } = await createTestBox('pi-live-bash-bg')
try {
  const bash = createBashOps(box)

  // --- backgrounded process must not hang the call ---
  let out = ''
  const started = Date.now()
  const res = await bash.exec('sleep 20 &\necho started', WORKDIR, {
    onData: (b) => (out += b.toString()),
    signal: undefined,
    timeout: undefined,
  })
  const secs = (Date.now() - started) / 1000
  assert(res.exitCode === 0, `background exit code 0 (got ${res.exitCode})`)
  assert(out.includes('started'), `foreground output captured (got: ${out})`)
  assert(secs < 15, `returned before the background sleep finished (took ${secs.toFixed(1)}s)`)
  console.log(`✓ backgrounded process returns immediately (${secs.toFixed(1)}s)`)

  // --- timeout enforcement ---
  const t = await bash.exec('sleep 30; echo survived', WORKDIR, {
    onData: () => {},
    signal: undefined,
    timeout: 3000,
  })
  assert(t.exitCode === 124, `timeout surfaces exit 124 (got ${t.exitCode})`)
  console.log('✓ in-shell timeout kills long commands with exit 124')

  console.log('\nlive-bash-bg passed.')
} finally {
  await cleanup()
}
