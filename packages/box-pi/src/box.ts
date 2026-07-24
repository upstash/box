/**
 * Copyright Upstash, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Resilience layer for box operations.
 *
 * A box can become unavailable mid-session: Upstash Box auto-pauses it after an
 * idle period, or it gets deleted. The Box coordinator auto-resumes a paused box
 * on the next exec/files/git/preview request, so most of the time no client-side
 * recovery is needed at all. What remains:
 *
 *   - a deleted box (404) must surface as a clear, actionable error instead of a
 *     cryptic HTTP failure — and the tool call must fail loudly, never silently
 *     fall back to the host;
 *   - a stale paused state can still make one request fail before the
 *     auto-resume kicks in — resume explicitly and retry once.
 *
 * The SDK throws a single `BoxError` with a `statusCode` (no typed subclasses),
 * so availability is decided by re-reading the box status rather than matching
 * error strings.
 */

import { type Box, BoxError, type Run } from '@upstash/box'
import { shellQuote, shortId } from './util.ts'

export class BoxUnavailableError extends Error {
  constructor(public readonly boxId: string) {
    super(
      `Upstash Box ${shortId(boxId)} is no longer available — it was likely deleted. ` +
        `Tool execution is paused (it was NOT run locally). Restart Pi with --box to get a fresh box.`,
    )
    this.name = 'BoxUnavailableError'
  }
}

/** True when the error is the SDK's 404 (box gone). */
export function isNotFound(err: unknown): boolean {
  return err instanceof BoxError && err.statusCode === 404
}

/**
 * Run a box operation. On failure, decide availability from the real box
 * status: 404/deleted -> BoxUnavailableError; paused -> resume and retry once
 * (normally the coordinator auto-resumes, this covers a stale-state edge);
 * anything else -> rethrow the genuine operation error.
 */
export async function withRecovery<T>(box: Box, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (isNotFound(err)) throw new BoxUnavailableError(box.id)
    let status: string | undefined
    try {
      status = (await box.getStatus()).status
    } catch (statusErr) {
      // Only a 404 means the box is truly gone. A transient/network status
      // failure must not be misreported as "removed" — surface the real op error.
      if (isNotFound(statusErr)) throw new BoxUnavailableError(box.id)
      throw err
    }
    if (status === 'deleted' || status === 'error') throw new BoxUnavailableError(box.id)
    if (status === 'paused') {
      try {
        await box.resume()
      } catch {
        throw new BoxUnavailableError(box.id)
      }
      return await fn()
    }
    // Box is fine — this was a genuine operation error.
    throw err
  }
}

/**
 * Prefix a command so it runs in `cwd`.
 *
 * Box's exec has no per-call working-directory parameter (the SDK's `box.cd()`
 * tracks cwd as client state, which races when Pi fires concurrent tool calls),
 * so the working directory is baked into the command string itself. The
 * subshell keeps a `cd` inside the user command from leaking.
 */
export function withCwd(command: string, cwd: string): string {
  return `cd ${shellQuote(cwd)} && (\n${command}\n)`
}

/**
 * Bound a command's runtime with coreutils `timeout`.
 *
 * Box's exec has no timeout parameter (and its synchronous endpoint is capped
 * at 5 minutes server-side), so shorter limits are enforced in-shell. On
 * timeout the command exits 124, which callers surface as-is.
 */
export function withTimeout(command: string, timeoutMs: number | undefined): string {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return command
  const secs = Math.max(1, Math.ceil(timeoutMs / 1000))
  return `timeout ${secs} sh -c ${shellQuote(command)}`
}

/** Synchronous exec with auto-recovery. Suitable for short internal commands. */
export async function execCommand(box: Box, command: string, cwd?: string): Promise<Run<string>> {
  const full = cwd ? withCwd(command, cwd) : command
  return withRecovery(box, () => box.exec.command(full))
}

/**
 * Streaming exec with auto-recovery on the initial request, forwarding output
 * chunks as they arrive. Used for the bash tool: the streaming endpoint has no
 * server-side duration cap (the sync one is limited to 5 minutes).
 *
 * Recovery applies only to starting the stream — an error mid-iteration is NOT
 * retried, because re-running the command could double-execute side effects.
 * An aborted signal stops consuming the stream; the remote command itself
 * cannot be cancelled mid-flight.
 */
export async function execStreamCollect(
  box: Box,
  command: string,
  cwd: string | undefined,
  onData: (data: string) => void,
  signal?: AbortSignal,
): Promise<{ exitCode: number | null }> {
  const full = cwd ? withCwd(command, cwd) : command
  const run = await withRecovery(box, () => box.exec.stream(full))
  let exitCode: number | null = null
  for await (const chunk of run) {
    if (signal?.aborted) throw new Error('aborted')
    if (chunk.type === 'output') {
      if (chunk.data) onData(chunk.data)
    } else if (chunk.type === 'exit') {
      exitCode = chunk.exitCode
    }
  }
  return { exitCode: exitCode ?? run.exitCode }
}
