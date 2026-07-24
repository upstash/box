/**
 * Copyright Upstash, Inc.
 * SPDX-License-Identifier: MIT
 */

/** Shared setup for live tests: jiti loader + box lifecycle helpers. */

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const root = path.resolve(__dirname, '..')

const hostEntry = fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))
const { createJiti } = createRequire(hostEntry)('jiti')
const jiti = createJiti(import.meta.url)

/** Import a TS module relative to the package root. */
export function load(rel) {
  return jiti.import(path.join(root, rel))
}

export function requireApiKey() {
  const key = process.env.UPSTASH_BOX_API_KEY?.trim()
  if (!key) {
    console.error('UPSTASH_BOX_API_KEY is required for live tests.')
    process.exit(1)
  }
  return key
}

/** Create a labeled test box; returns { box, cleanup }. */
export async function createTestBox(name) {
  const { Box } = await import('@upstash/box')
  const apiKey = requireApiKey()
  console.log(`creating box (${name})…`)
  const started = Date.now()
  const box = await Box.create({ apiKey, name, labels: ['created-by:pi-test'] })
  console.log(`box ready: ${box.id} (${((Date.now() - started) / 1000).toFixed(1)}s)`)
  const cleanup = async () => {
    try {
      await box.delete()
      console.log(`box deleted: ${box.id}`)
    } catch (err) {
      console.error(`WARNING: failed to delete box ${box.id}: ${err?.message ?? err}`)
    }
  }
  return { box, cleanup }
}

export function assert(cond, message) {
  if (!cond) throw new Error(`Assertion failed: ${message}`)
}
