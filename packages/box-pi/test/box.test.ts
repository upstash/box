import { BoxError } from '@upstash/box'
import { describe, expect, it } from 'vitest'
import {
  BoxUnavailableError,
  execCommand,
  execStreamCollect,
  isNotFound,
  withCwd,
  withRecovery,
  withTimeout,
} from '../src/box.ts'
import { fakeBox, fakeRun, fakeStream } from './helpers.ts'

describe('isNotFound', () => {
  it('matches only BoxError 404', () => {
    expect(isNotFound(new BoxError('gone', 404))).toBe(true)
    expect(isNotFound(new BoxError('server', 500))).toBe(false)
    expect(isNotFound(new Error('404'))).toBe(false)
  })
})

describe('withRecovery', () => {
  it('passes through success', async () => {
    const box = fakeBox()
    await expect(withRecovery(box, async () => 42)).resolves.toBe(42)
    expect(box.calls.statusChecks).toBe(0)
  })

  it('maps a 404 op error to BoxUnavailableError', async () => {
    const box = fakeBox()
    await expect(
      withRecovery(box, async () => {
        throw new BoxError('not found', 404)
      }),
    ).rejects.toThrow(BoxUnavailableError)
  })

  it('resumes a paused box and retries once', async () => {
    const box = fakeBox({ status: 'paused' })
    let attempts = 0
    const result = await withRecovery(box, async () => {
      attempts++
      if (attempts === 1) throw new BoxError('box is paused', 409)
      return 'ok'
    })
    expect(result).toBe('ok')
    expect(attempts).toBe(2)
    expect(box.calls.resume).toBe(1)
  })

  it('rethrows genuine op errors when the box is healthy', async () => {
    const box = fakeBox({ status: 'running' })
    await expect(
      withRecovery(box, async () => {
        throw new Error('command failed')
      }),
    ).rejects.toThrow(/command failed/)
    expect(box.calls.resume).toBe(0)
  })

  it('treats a 404 status as the box being gone', async () => {
    const box = fakeBox()
    box.getStatus = async () => {
      throw new BoxError('gone', 404)
    }
    await expect(
      withRecovery(box, async () => {
        throw new Error('op failed')
      }),
    ).rejects.toThrow(BoxUnavailableError)
  })

  it('surfaces the ORIGINAL op error when the status check fails transiently', async () => {
    const box = fakeBox()
    box.getStatus = async () => {
      throw new Error('network blip')
    }
    await expect(
      withRecovery(box, async () => {
        throw new Error('the real op error')
      }),
    ).rejects.toThrow(/the real op error/)
  })

  it.each(['deleted', 'error'])('maps %s status to BoxUnavailableError', async (status) => {
    const box = fakeBox({ status })
    await expect(
      withRecovery(box, async () => {
        throw new Error('op failed')
      }),
    ).rejects.toThrow(BoxUnavailableError)
  })

  it('maps a failed resume to BoxUnavailableError', async () => {
    const box = fakeBox({ status: 'paused' })
    box.resume = async () => {
      throw new BoxError('cannot resume', 500)
    }
    await expect(
      withRecovery(box, async () => {
        throw new Error('op failed')
      }),
    ).rejects.toThrow(BoxUnavailableError)
  })
})

describe('command builders', () => {
  it('withCwd prefixes cd with a quoted path and subshell', () => {
    const cmd = withCwd('echo hi', "/workspace/home/my repo's dir")
    expect(cmd).toMatch(/^cd '\/workspace\/home\/my repo'\\''s dir' && \(\n/)
    expect(cmd).toMatch(/echo hi\n\)$/)
  })

  it('withTimeout wraps in coreutils timeout with ceiled seconds', () => {
    expect(withTimeout('echo hi', undefined)).toBe('echo hi')
    expect(withTimeout('echo hi', 0)).toBe('echo hi')
    expect(withTimeout('echo hi', Number.NaN)).toBe('echo hi')
    expect(withTimeout('echo hi', 1500)).toBe(`timeout 2 sh -c 'echo hi'`)
    expect(withTimeout('echo hi', 500)).toBe(`timeout 1 sh -c 'echo hi'`)
  })
})

describe('execCommand', () => {
  it('applies the cwd prefix and recovers', async () => {
    const box = fakeBox({ onExec: (cmd) => fakeRun({ stdout: cmd }) })
    const res = await execCommand(box, 'pwd', '/workspace/home/api')
    expect(res.stdout).toMatch(/^cd '\/workspace\/home\/api' && \(/)
    const bare = await execCommand(box, 'pwd')
    expect(bare.stdout).toBe('pwd')
  })
})

describe('execStreamCollect', () => {
  it('forwards output chunks and returns the exit code', async () => {
    const box = fakeBox({
      onStream: () =>
        fakeStream([
          { type: 'output', data: 'hello ' },
          { type: 'output', data: 'world' },
          { type: 'exit', exitCode: 3, cpuNs: 1 },
        ]),
    })
    const chunks: string[] = []
    const { exitCode } = await execStreamCollect(box, 'cmd', '/w', (d) => chunks.push(d))
    expect(chunks.join('')).toBe('hello world')
    expect(exitCode).toBe(3)
    expect(box.calls.stream[0]).toMatch(/^cd '\/w' && \(/)
  })

  it('falls back to run.exitCode without an exit chunk', async () => {
    const box = fakeBox({ onStream: () => fakeStream([{ type: 'output', data: 'x' }], { exitCode: 0 }) })
    const { exitCode } = await execStreamCollect(box, 'cmd', undefined, () => {})
    expect(exitCode).toBe(0)
  })

  it('aborts between chunks', async () => {
    const ac = new AbortController()
    const box = fakeBox({
      onStream: () =>
        fakeStream([
          { type: 'output', data: 'first' },
          { type: 'output', data: 'second' },
        ]),
    })
    await expect(execStreamCollect(box, 'cmd', undefined, () => ac.abort(), ac.signal)).rejects.toThrow(/aborted/)
  })
})
