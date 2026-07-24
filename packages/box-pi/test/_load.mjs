/**
 * Copyright Upstash, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Shared test loader: import the extension's TypeScript sources the same way
 * Pi does (via jiti), so tests exercise the real shipped code with no build.
 */

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const root = path.resolve(__dirname, '..')

// Resolve the host package's exported entry with the ESM-aware resolver (the
// package ships an import-only `exports` map, so CJS require.resolve throws
// ERR_PACKAGE_PATH_NOT_EXPORTED); it walks hoisting too. Then anchor a CJS
// require there for jiti (which is CJS-compatible).
const hostEntry = fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))
const { createJiti } = createRequire(hostEntry)('jiti')
const jiti = createJiti(import.meta.url)

/** Import a TS module relative to the package root, e.g. `load('src/util.ts')`. */
export function load(rel) {
  return jiti.import(path.join(root, rel))
}

/**
 * A minimal fake `Run` result, mirroring the property surface our code reads
 * from @upstash/box's Run class.
 */
export function fakeRun({ stdout = '', stderr = '', exitCode = 0 } = {}) {
  return {
    stdout,
    stderr,
    exitCode,
    result: exitCode === 0 ? stdout : stderr || stdout,
    status: exitCode === 0 ? 'completed' : 'failed',
  }
}

/**
 * A minimal fake Box. `onExec(command)` decides each exec.command result and
 * records calls; override any namespace as needed. Healthy by default.
 */
export function fakeBox({ onExec, onStream, status = 'running' } = {}) {
  const calls = { exec: [], stream: [], resume: 0, statusChecks: 0 }
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
      async command(command) {
        calls.exec.push(command)
        return onExec ? onExec(command) : fakeRun()
      },
      async stream(command) {
        calls.stream.push(command)
        if (!onStream) throw new Error('no onStream configured')
        return onStream(command)
      },
    },
    files: {},
    git: {},
  }
  return box
}

/** Build an async-iterable StreamRun-alike from a list of chunks. */
export function fakeStream(chunks, { exitCode = null } = {}) {
  return {
    exitCode,
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c
    },
  }
}
