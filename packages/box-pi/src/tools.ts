/**
 * Copyright Upstash, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Tool registration.
 *
 * Each of Pi's built-in tools is replaced with a box-backed variant:
 * - a box is active         -> the tool runs inside it
 * - `--box` set, no box     -> the call FAILS (never run on your host)
 * - `--box` off             -> the extension is dormant, Pi's local tool runs
 *
 * The operation-backed tools (bash/read/write/edit/ls) share one wrapper;
 * find/grep run a dedicated in-box search; preview_url is a custom tool.
 */

import type { Box } from '@upstash/box'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { withRecovery } from './box.ts'
import { type FindParams, runRemoteFind } from './find-tool.ts'
import { type GrepParams, runRemoteGrep } from './grep-tool.ts'
import { createBashOps, createEditOps, createLsOps, createReadOps, createWriteOps } from './ops.ts'

/** The bits of the active box the tools need. */
export interface ToolBox {
  box: Box
  cwd: string
}

/**
 * Register all tools. `getActive` returns the box bound to the current
 * session, or null when running locally.
 */
export function registerTools(pi: ExtensionAPI, getActive: () => ToolBox | null): void {
  const localCwd = process.cwd()
  const localBash = createBashTool(localCwd)
  const localRead = createReadTool(localCwd)
  const localWrite = createWriteTool(localCwd)
  const localEdit = createEditTool(localCwd)
  const localLs = createLsTool(localCwd)
  const localFind = createFindTool(localCwd)
  const localGrep = createGrepTool(localCwd)

  /**
   * Resolve the box for a tool call. With `--box` on but no box, we throw
   * rather than run on the host. With `--box` off, return null so the local
   * tool runs (the extension is dormant — it never breaks normal Pi usage).
   */
  function requireBox(): ToolBox | null {
    const active = getActive()
    if (active) return active
    if (pi.getFlag('box') === true) {
      throw new Error('Upstash Box is unavailable — the tool was NOT run on your host. Restart Pi.')
    }
    return null
  }

  /** Wrap a tool so it runs against the box (built per call) when one is active. */
  function boxTool<T extends { execute: (...args: never[]) => unknown }>(
    local: T,
    makeRemote: (cwd: string, box: Box) => T,
  ): T {
    return {
      ...local,
      execute: (...args: Parameters<T['execute']>) => {
        const active = requireBox()
        const tool = active ? makeRemote(active.cwd, active.box) : local
        return tool.execute(...args)
      },
    } as T
  }

  pi.registerTool(boxTool(localBash, (cwd, box) => createBashTool(cwd, { operations: createBashOps(box) })))
  pi.registerTool(boxTool(localRead, (cwd, box) => createReadTool(cwd, { operations: createReadOps(box) })))
  pi.registerTool(boxTool(localWrite, (cwd, box) => createWriteTool(cwd, { operations: createWriteOps(box) })))
  pi.registerTool(boxTool(localEdit, (cwd, box) => createEditTool(cwd, { operations: createEditOps(box) })))
  pi.registerTool(boxTool(localLs, (cwd, box) => createLsTool(cwd, { operations: createLsOps(box) })))

  // find and grep can't be redirected via operations: Pi runs fd/ripgrep
  // locally and their operations don't delegate the search. So we run the
  // search inside the box via dedicated tools.
  pi.registerTool({
    ...localFind,
    async execute(id, params, signal, onUpdate) {
      const active = requireBox()
      if (active) {
        // Only a pre-aborted signal is honorable: the search is a single
        // blocking exec with no mid-flight cancel and no incremental output.
        if (signal?.aborted) throw new Error('aborted')
        return runRemoteFind(active.box, active.cwd, params as FindParams)
      }
      return localFind.execute(id, params, signal, onUpdate)
    },
  })

  pi.registerTool({
    ...localGrep,
    async execute(id, params, signal, onUpdate) {
      const active = requireBox()
      if (active) {
        // See find above.
        if (signal?.aborted) throw new Error('aborted')
        return runRemoteGrep(active.box, active.cwd, params as GrepParams)
      }
      return localGrep.execute(id, params, signal, onUpdate)
    },
  })

  // Custom tool: let the agent fetch a port's public URL itself, so after it
  // starts a server (e.g. `npm run dev &`) it can hand the user a clickable
  // link. The URL is created FRESH on every call and never cached: pausing a
  // box (including the automatic idle pause) deletes its preview records
  // server-side, so a stored URL can go stale at any time.
  pi.registerTool({
    name: 'preview_url',
    label: 'Preview URL',
    description:
      'Get the public preview URL for a port served inside the Upstash Box. ' +
      'Use this after starting a server (e.g. a dev server on port 3000) to give the user a link. ' +
      'Call it again if the box was paused in between — URLs do not survive a pause.',
    promptSnippet: 'Get a browser-openable preview URL for a port served in the box',
    parameters: Type.Object({
      port: Type.Integer({
        minimum: 1,
        maximum: 65535,
        description: 'The port the server listens on inside the box',
      }),
    }),
    async execute(_id, { port }) {
      const active = requireBox()
      if (!active) {
        return { content: [{ type: 'text', text: 'No active Upstash Box.' }], details: undefined }
      }
      const { box } = active
      // Basic auth (not bearer): the preview proxy only accepts bearer tokens
      // via the Authorization header, which a browser can't send — but it
      // answers 401 with WWW-Authenticate: Basic, so basic auth gets a native
      // browser login prompt. Protected by default AND clickable.
      const link = await withRecovery(box, () => box.getPublicURL(port, { basicAuth: true }))
      const text =
        `Preview URL for port ${port}: ${link.url}\n` +
        `Login: ${link.username} / ${link.password} (the browser will prompt; for curl use -u ${link.username}:${link.password})\n` +
        `The URL stops working when the box pauses — call this tool again to get a fresh one.`
      return { content: [{ type: 'text', text }], details: undefined }
    },
  })

  // Route user `!` bash commands to the box. When --box is set but no box is
  // available, return an error result so the command is NOT run on the host.
  // With --box off, return undefined to let Pi run it locally.
  pi.on('user_bash', () => {
    const active = getActive()
    // Pi runs user `!` commands with the HOST working directory
    // (sessionManager.getCwd()), which doesn't exist in the box — so pin the
    // cwd to the box working dir (active.cwd), where the user expects `!` to run.
    if (active) return { operations: createBashOps(active.box, active.cwd) }
    if (pi.getFlag('box') === true) {
      return {
        result: {
          output: 'Upstash Box is unavailable — the command was NOT run on your host. Restart Pi.',
          exitCode: 1,
          cancelled: false,
          truncated: false,
        },
      }
    }
    return
  })
}
