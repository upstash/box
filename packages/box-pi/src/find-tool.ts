/**
 * Copyright Upstash, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Remote find (by filename glob).
 *
 * Pi's built-in find tool runs `fd` on the LOCAL machine and its operations
 * don't delegate the actual globbing, so the search must run inside the box.
 *
 * `rg --files -g <glob>` matches `fd`'s semantics closely: it respects
 * .gitignore, supports path globs, and emits paths relative to the search dir.
 * A POSIX `find` basename fallback covers images without ripgrep.
 */

import type { Box } from '@upstash/box'
import { execCommand } from './box.ts'
import { joinPath, shellQuote } from './util.ts'

/** Mirrors Pi's findSchema. */
export interface FindParams {
  pattern: string
  path?: string
  limit?: number
}

const DEFAULT_LIMIT = 1000

export interface RemoteSearchResult {
  content: { type: 'text'; text: string }[]
  details: undefined
}

export async function runRemoteFind(box: Box, cwd: string, params: FindParams): Promise<RemoteSearchResult> {
  const { pattern, path: searchDir = '.', limit } = params
  // Guard against malformed input (NaN/Infinity/non-integer) before it reaches
  // `head -n`, which would otherwise become e.g. `head -n NaN`.
  const requested = limit ?? DEFAULT_LIMIT
  const max = Number.isFinite(requested) ? Math.max(1, Math.floor(requested)) : DEFAULT_LIMIT
  const searchPath = searchDir.startsWith('/')
    ? searchDir
    : searchDir === '.' || searchDir === './'
      ? cwd
      : joinPath(cwd, searchDir)

  // Mirror Pi: a path glob (contains "/") should match at any depth.
  let effective = pattern
  if (pattern.includes('/') && !pattern.startsWith('/') && !pattern.startsWith('**/') && pattern !== '**') {
    effective = `**/${pattern}`
  }

  // Basename for the POSIX find fallback (last path segment of the pattern).
  const basename = effective.split('/').pop() || effective

  const rg = [
    'rg',
    '--files',
    '--hidden',
    '-g',
    shellQuote('!**/.git/**'),
    '-g',
    shellQuote('!**/node_modules/**'),
    '-g',
    shellQuote(effective),
  ].join(' ')

  // Use POSIX `!` (not GNU `-not`) so this works on busybox/dash/strict-POSIX
  // find. GNU find accepts `!` too, so this is a strict portability improvement.
  const find = [
    'find',
    '.',
    '-type',
    'f',
    '-name',
    shellQuote(basename),
    '!',
    '-path',
    shellQuote('*/.git/*'),
    '!',
    '-path',
    shellQuote('*/node_modules/*'),
  ].join(' ')

  // Two shell paths depending on whether the runtime image has bash:
  //
  //   bash present (default Box runtimes) -> STREAMING via pipe-to-head.
  //     Search dies via SIGPIPE after `max` results. `PIPESTATUS[0]` preserves
  //     the search's real exit code across the pipe.
  //
  //   bash absent (-alpine/busybox runtimes without bash) -> BUFFERED via temp
  //     file (same idiom as ops.ts `backgroundSafe`). Loses streaming perf but
  //     works everywhere and still preserves exit codes.
  //
  // Both branches use different exit-code normalization for rg vs find because
  // the tools disagree on what "1" means:
  //   rg:   0=matches, 1=no-matches (OK), 141=SIGPIPE (streaming only), 2+=error
  //   find: 0=success (matched or not), 141=SIGPIPE (streaming only), 1+=error
  // So `1` is OK for rg but is a real error for find.
  const bashScript = [
    'set +e',
    'if command -v rg >/dev/null 2>&1; then',
    `  ${rg} 2>/dev/null | head -n ${max}`,
    '  rc=${PIPESTATUS[0]:-$?}',
    '  case "$rc" in 0|1|141) exit 0 ;; esac',
    'else',
    `  ${find} 2>/dev/null | head -n ${max}`,
    '  rc=${PIPESTATUS[0]:-$?}',
    '  case "$rc" in 0|141) exit 0 ;; esac',
    'fi',
    'exit "$rc"',
  ].join('\n')
  const posixFallback = [
    '__pi_out=$(mktemp 2>/dev/null || echo "/tmp/pi-find-$$.out")',
    'if command -v rg >/dev/null 2>&1; then',
    `  ( ${rg} ) >"$__pi_out" 2>/dev/null`,
    '  rc=$?',
    `  head -n ${max} "$__pi_out"`,
    '  rm -f "$__pi_out"',
    '  case "$rc" in 0|1) exit 0 ;; esac',
    'else',
    `  ( ${find} ) >"$__pi_out" 2>/dev/null`,
    '  rc=$?',
    `  head -n ${max} "$__pi_out"`,
    '  rm -f "$__pi_out"',
    '  case "$rc" in 0) exit 0 ;; esac',
    'fi',
    'exit "$rc"',
  ].join('\n')
  const command = [
    'if command -v bash >/dev/null 2>&1; then',
    `  bash -c ${shellQuote(bashScript)}`,
    '  exit $?',
    'fi',
    posixFallback,
  ].join('\n')

  const res = await execCommand(box, command, searchPath)
  if ((res.exitCode ?? 0) !== 0) {
    throw new Error(`find failed in ${searchPath} (exit ${res.exitCode})`)
  }
  // Strip only the leading `./` and a trailing CR — never trim, which would
  // corrupt filenames with legitimate leading/trailing spaces.
  const lines = (res.stdout ?? '')
    .split('\n')
    .map((l) => l.replace(/^\.\//, '').replace(/\r$/, ''))
    .filter((l) => l.length > 0)

  const body = lines.length > 0 ? lines.join('\n') : 'No files found matching pattern'
  return { content: [{ type: 'text', text: body }], details: undefined }
}
