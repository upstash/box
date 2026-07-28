/**
 * Copyright Upstash, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Box-backed implementations of Pi's pluggable tool operations.
 *
 * The `bash`, `read`, `write`, `edit`, and `ls` tools accept an `*Operations`
 * object. We provide versions that run against a remote Upstash Box instead of
 * the local machine. The tool factories are given the box working directory as
 * their `cwd`, so the absolute paths Pi resolves and hands to these ops are
 * already box-rooted.
 *
 * `grep` and `find` are NOT here: Pi runs ripgrep/fd locally and their
 * operations don't delegate the actual search. Those run inside the box via
 * `grep-tool.ts` / `find-tool.ts`.
 */

import type { Box } from '@upstash/box'
import type {
  BashOperations,
  EditOperations,
  LsOperations,
  ReadOperations,
  WriteOperations,
} from '@earendil-works/pi-coding-agent'
import { execCommand, execStreamCollect, withRecovery, withTimeout } from './box.ts'
import { shellQuote } from './util.ts'

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

/** Run a command in the box and return its stdout and exit code. */
async function run(box: Box, command: string): Promise<{ stdout: string; exitCode: number }> {
  const res = await execCommand(box, command)
  return { stdout: res.stdout ?? '', exitCode: res.exitCode ?? 0 }
}

/**
 * Wrap a command so backgrounded processes can't hang the call.
 *
 * Box's exec (sync and streaming alike) completes only when the command's
 * stdout/stderr reach EOF. A backgrounded process (`server &`) inherits those
 * pipes and holds them open indefinitely, so the call never returns. We run
 * the command in a subshell whose combined output is redirected to a temp
 * file, then replay the file and re-raise the real exit code. Background
 * descendants then write to the file (not the result pipe), so the call
 * returns as soon as the FOREGROUND finishes — matching Pi's local
 * "background and return" behavior. A subshell (not a brace group) keeps any
 * `exit` inside the user command from skipping the replay. The newline before
 * `)` correctly terminates a trailing `&`.
 */
export function backgroundSafe(command: string): string {
  return [
    '__pi_out=$(mktemp 2>/dev/null || echo "/tmp/pi-box-$$.out")',
    `( ${command}`,
    ') >"$__pi_out" 2>&1',
    '__pi_rc=$?',
    'cat "$__pi_out"',
    'rm -f "$__pi_out"',
    'exit $__pi_rc',
  ].join('\n')
}

/**
 * Build bash operations backed by the box.
 *
 * Commands run through the STREAMING exec endpoint: the synchronous one is
 * hard-capped at 5 minutes server-side, and streaming lets long builds run to
 * completion. Output still arrives when the foreground finishes (see
 * backgroundSafe — it must buffer to a temp file so `server &` can't hang the
 * call), which matches Pi's local behavior for backgrounded work.
 *
 * `cwdOverride` forces the working directory regardless of what the caller
 * passes. The agent's bash tool resolves box-rooted paths and omits it; the
 * user `!` handler passes the box cwd (see the user_bash handler in tools.ts
 * for why).
 */
export function createBashOps(box: Box, cwdOverride?: string): BashOperations {
  return {
    exec: async (command, cwd, { onData, signal, timeout }) => {
      if (signal?.aborted) throw new Error('aborted')
      // We deliberately do not forward the host `env` into the box: the
      // container has its own environment, and leaking host vars is unsafe.
      // Pi's timeout (ms) is enforced in-shell via coreutils `timeout` — Box's
      // exec has no timeout parameter (see withTimeout).
      const wrapped = backgroundSafe(withTimeout(command, timeout))
      const { exitCode } = await execStreamCollect(
        box,
        wrapped,
        cwdOverride ?? cwd,
        (data) => onData(Buffer.from(data)),
        signal,
      )
      return { exitCode }
    },
  }
}

export function createReadOps(box: Box): ReadOperations {
  return {
    // Read via base64 so binary files (images) survive the JSON transport.
    readFile: async (path) => {
      const content = await withRecovery(box, () => box.files.read(path, { encoding: 'base64' }))
      return Buffer.from(content, 'base64')
    },
    access: async (path) => {
      const { exitCode } = await run(box, `test -r ${shellQuote(path)}`)
      if (exitCode !== 0) throw new Error(`File not readable: ${path}`)
    },
    detectImageMimeType: async (path) => {
      try {
        const { stdout } = await run(box, `file --mime-type -b ${shellQuote(path)}`)
        const mime = stdout.trim()
        return IMAGE_MIME_TYPES.has(mime) ? mime : null
      } catch {
        return null
      }
    },
  }
}

export function createWriteOps(box: Box): WriteOperations {
  return {
    writeFile: (path, content) =>
      withRecovery(box, () => box.files.write({ path, content })),
    mkdir: async (dir) => {
      const { exitCode } = await run(box, `mkdir -p ${shellQuote(dir)}`)
      if (exitCode !== 0) throw new Error(`Failed to create directory: ${dir}`)
    },
  }
}

export function createEditOps(box: Box): EditOperations {
  // Pi's edit tool reads the file, applies exact oldText->newText edits
  // in-process, then writes it back — preserving its uniqueness checks.
  // This is the download -> modify -> upload strategy.
  return {
    readFile: async (path) => {
      const content = await withRecovery(box, () => box.files.read(path, { encoding: 'base64' }))
      return Buffer.from(content, 'base64')
    },
    writeFile: (path, content) =>
      withRecovery(box, () => box.files.write({ path, content })),
    access: async (path) => {
      const { exitCode } = await run(box, `test -r ${shellQuote(path)} && test -w ${shellQuote(path)}`)
      if (exitCode !== 0) throw new Error(`File not readable/writable: ${path}`)
    },
  }
}

export function createLsOps(box: Box): LsOperations {
  return {
    exists: async (path) => {
      const { exitCode } = await run(box, `test -e ${shellQuote(path)}`)
      return exitCode === 0
    },
    stat: async (path) => {
      const q = shellQuote(path)
      // `test -e || exit 1` makes a missing path a real non-zero exit; the
      // `|| echo other` only masks the `test -d` result, which is fine since
      // existence is already decided.
      const { stdout, exitCode } = await run(box, `test -e ${q} || exit 1; test -d ${q} && echo dir || echo other`)
      if (exitCode !== 0) throw new Error(`Path not found: ${path}`)
      const isDir = stdout.trim() === 'dir'
      return { isDirectory: () => isDir }
    },
    readdir: async (path) => {
      const { stdout, exitCode } = await run(box, `ls -1A ${shellQuote(path)}`)
      if (exitCode !== 0) throw new Error(`Failed to read directory: ${path}`)
      return stdout.split('\n').filter((line) => line.length > 0)
    },
  }
}
