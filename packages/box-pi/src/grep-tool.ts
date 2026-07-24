/**
 * Copyright Upstash, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Remote grep.
 *
 * Pi's built-in grep tool always spawns ripgrep on the LOCAL machine and only
 * uses its GrepOperations to read context lines — so swapping operations does
 * not redirect the search. To grep a box we must run the search inside it.
 *
 * This runs ripgrep in the box (falling back to POSIX grep when rg is not
 * installed) and returns matching `path:line: text` lines, mirroring the shape
 * of Pi's grep output closely enough for the model.
 */

import type { Box } from '@upstash/box'
import { execCommand } from './box.ts'
import { shellQuote } from './util.ts'

/** Mirrors Pi's grepSchema. */
export interface GrepParams {
  pattern: string
  path?: string
  glob?: string
  ignoreCase?: boolean
  literal?: boolean
  context?: number
  limit?: number
}

const DEFAULT_LIMIT = 100

export interface RemoteGrepResult {
  content: { type: 'text'; text: string }[]
  details: undefined
}

export async function runRemoteGrep(box: Box, cwd: string, params: GrepParams): Promise<RemoteGrepResult> {
  const { pattern, path: searchDir = '.', glob, ignoreCase, literal, context, limit } = params
  // Guard against malformed input (NaN/Infinity/non-integer) before it reaches
  // `head -n`, which would otherwise become e.g. `head -n NaN`.
  const requested = limit ?? DEFAULT_LIMIT
  const max = Number.isFinite(requested) ? Math.max(1, Math.floor(requested)) : DEFAULT_LIMIT
  // Same guard as `max`: context is interpolated into `--context`/`-C`, so reject
  // Infinity/non-integer before it becomes e.g. `--context Infinity`. Default to 0
  // first so the value narrows to a number (mirrors find-tool.ts).
  const ctxRequested = context ?? 0
  const ctxLines = Number.isFinite(ctxRequested) && ctxRequested > 0 ? Math.floor(ctxRequested) : 0

  const rg = ['rg', '--line-number', '--no-heading', '--color=never', '--hidden']
  if (ignoreCase) rg.push('--ignore-case')
  if (literal) rg.push('--fixed-strings')
  if (ctxLines) rg.push('--context', String(ctxLines))
  if (glob) rg.push('--glob', shellQuote(glob))
  rg.push('--', shellQuote(pattern), shellQuote(searchDir))

  // GNU-ish grep fallback (used when bash is present but rg is not). Assumes
  // GNU/busybox grep; the flags `-r`, `-I`, `-C`, `--include` are non-POSIX
  // extensions that most bash-having systems provide.
  const gp = ['grep', '-rnI']
  if (ignoreCase) gp.push('-i')
  if (literal) gp.push('-F')
  if (ctxLines) gp.push('-C', String(ctxLines))
  if (glob) gp.push(`--include=${shellQuote(glob)}`)
  gp.push('--', shellQuote(pattern), shellQuote(searchDir))

  // Strict-POSIX grep fallback (used only on bash-less + rg-less runtimes —
  // the deepest fallback path). Uses `find … -exec grep` with ONLY POSIX flags
  // (-n, -i, -F, -e). Trades away `-I` (skip binaries) and `-C` (context) for
  // universal portability; those are GNU extensions strict POSIX grep lacks.
  const posixGp = ['find', shellQuote(searchDir), '-type', 'f']
  if (glob) posixGp.push('-name', shellQuote(glob))
  posixGp.push('!', '-path', shellQuote('*/.git/*'))
  posixGp.push('!', '-path', shellQuote('*/node_modules/*'))
  posixGp.push('-exec', 'grep', '-n')
  if (ignoreCase) posixGp.push('-i')
  if (literal) posixGp.push('-F')
  posixGp.push('-e', shellQuote(pattern), '/dev/null', '{}', '+')

  // Two shell paths depending on whether the runtime image has bash — see
  // find-tool.ts for the full rationale (streaming pipe-to-head vs buffered
  // temp file, and the PIPESTATUS exit-code preservation).
  //
  // Both branches normalize expected outcomes to exit 0 so the caller sees
  // nonzero only for a real error:
  //   rg/grep: 0=matches, 1=no-matches (OK), 141=SIGPIPE (streaming only), 2+=error
  const bashScript = [
    'set +e',
    'if command -v rg >/dev/null 2>&1; then',
    `  ${rg.join(' ')} 2>/dev/null | head -n ${max}`,
    '  rc=${PIPESTATUS[0]:-$?}',
    'else',
    `  ${gp.join(' ')} 2>/dev/null | head -n ${max}`,
    '  rc=${PIPESTATUS[0]:-$?}',
    'fi',
    'case "$rc" in 0|1|141) exit 0 ;; esac',
    'exit "$rc"',
  ].join('\n')
  const posixFallback = [
    '__pi_out=$(mktemp 2>/dev/null || echo "/tmp/pi-grep-$$.out")',
    'if command -v rg >/dev/null 2>&1; then',
    `  ( ${rg.join(' ')} ) >"$__pi_out" 2>/dev/null`,
    'else',
    `  ( ${posixGp.join(' ')} ) >"$__pi_out" 2>/dev/null`,
    'fi',
    'rc=$?',
    `head -n ${max} "$__pi_out"`,
    'rm -f "$__pi_out"',
    'case "$rc" in 0|1) exit 0 ;; esac',
    'exit "$rc"',
  ].join('\n')
  const command = [
    'if command -v bash >/dev/null 2>&1; then',
    `  bash -c ${shellQuote(bashScript)}`,
    '  exit $?',
    'fi',
    posixFallback,
  ].join('\n')

  const res = await execCommand(box, command, cwd)
  if ((res.exitCode ?? 0) !== 0) {
    throw new Error(`grep failed in ${searchDir} (exit ${res.exitCode})`)
  }
  const text = (res.stdout ?? '').replace(/\s+$/, '')
  const body = text.length > 0 ? text : `No matches found for /${pattern}/ in ${searchDir}`
  return { content: [{ type: 'text', text: body }], details: undefined }
}
