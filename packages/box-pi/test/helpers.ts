/**
 * Copyright Upstash, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Test doubles for the @upstash/box surface the extension talks to.
 *
 * The fakes implement only the handful of members our code actually reads, so
 * they're cast to the real types once, here, rather than at every call site.
 */

import type { Box, ExecStreamChunk, Run, StreamRun } from '@upstash/box'

/** Calls recorded by {@link fakeBox}, for assertions. */
export interface FakeBoxCalls {
  exec: string[]
  stream: string[]
  resume: number
  statusChecks: number
}

export type FakeBox = Box & { calls: FakeBoxCalls }

/**
 * A minimal fake `Run` result, mirroring the property surface our code reads
 * from @upstash/box's Run class.
 */
export function fakeRun({ stdout = '', stderr = '', exitCode = 0 } = {}): Run<string> {
  return {
    stdout,
    stderr,
    exitCode,
    result: exitCode === 0 ? stdout : stderr || stdout,
    status: exitCode === 0 ? 'completed' : 'failed',
  } as unknown as Run<string>
}

export interface FakeBoxOptions {
  /** Decides each `exec.command` result. Returns a healthy empty run by default. */
  onExec?: (command: string) => Run<string>
  /** Decides each `exec.stream` result. Throws if a test streams without one. */
  onStream?: (command: string) => StreamRun<string, ExecStreamChunk>
  /** Box status, as a value or a per-call function. Healthy by default. */
  status?: string | (() => string)
}

/**
 * A minimal fake Box. `onExec(command)` decides each exec result and records
 * calls; override any namespace as needed.
 */
export function fakeBox({ onExec, onStream, status = 'running' }: FakeBoxOptions = {}): FakeBox {
  const calls: FakeBoxCalls = { exec: [], stream: [], resume: 0, statusChecks: 0 }
  const box = {
    id: 'box-0123456789abcdef',
    size: 'small',
    keepAlive: false,
    calls,
    async getStatus() {
      calls.statusChecks++
      return { status: typeof status === 'function' ? status() : status }
    },
    async resume() {
      calls.resume++
    },
    exec: {
      async command(command: string) {
        calls.exec.push(command)
        return onExec ? onExec(command) : fakeRun()
      },
      async stream(command: string) {
        calls.stream.push(command)
        if (!onStream) throw new Error('no onStream configured')
        return onStream(command)
      },
    },
    files: {},
    git: {},
  }
  return box as unknown as FakeBox
}

/** Build an async-iterable StreamRun-alike from a list of chunks. */
export function fakeStream(
  chunks: ExecStreamChunk[],
  { exitCode = null }: { exitCode?: number | null } = {},
): StreamRun<string, ExecStreamChunk> {
  return {
    exitCode,
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c
    },
  } as unknown as StreamRun<string, ExecStreamChunk>
}
