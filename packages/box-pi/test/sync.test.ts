import { describe, expect, it } from 'vitest'
import { getAheadCount, pushChanges, type PushTarget, refreshGitCredentials } from '../src/sync.ts'
import { type FakeBox, fakeBox, fakeRun } from './helpers.ts'

interface GitBoxOptions {
  /** `rev-list --count` output, or an Error the git exec should throw. */
  ahead?: string | Error
  onPush?: (options?: { branch?: string }) => void | Promise<void>
}

type GitBox = FakeBox & {
  gitCalls: { exec: string[][]; push: ({ branch?: string } | undefined)[] }
}

/** A fake box whose git namespace records `exec`/`push` and is scriptable. */
function gitBox({ ahead = '1', onPush }: GitBoxOptions = {}): GitBox {
  const box = fakeBox({ onExec: () => fakeRun() }) as GitBox
  box.gitCalls = { exec: [], push: [] }
  box.git.exec = async ({ args }) => {
    box.gitCalls.exec.push(args)
    if (ahead instanceof Error) throw ahead
    return { output: `${ahead}\n` } as Awaited<ReturnType<typeof box.git.exec>>
  }
  box.git.push = async (options) => {
    box.gitCalls.push.push(options)
    await onPush?.(options)
  }
  return box
}

const target = (box: FakeBox): PushTarget => ({ box, branch: 'pi/abc', syncConfigured: true })

describe('refreshGitCredentials', () => {
  it('seeds the credential store and gh config', async () => {
    const box = fakeBox({ onExec: () => fakeRun() })
    await refreshGitCredentials(box, 'gho_secret')
    expect(box.calls.exec).toHaveLength(1)
    const cmd = box.calls.exec[0]
    expect(cmd).toMatch(/credential\.helper store/)
    expect(cmd).toMatch(/git credential approve/)
    expect(cmd).toMatch(/hosts\.yml/)
    expect(cmd).toMatch(/'gho_secret'/) // token is shell-quoted
  })

  it('quotes hostile tokens', async () => {
    const box = fakeBox({ onExec: () => fakeRun() })
    await refreshGitCredentials(box, `x'; rm -rf / #`)
    expect(box.calls.exec[0]).toMatch(/'x'\\''; rm -rf \/ #'/)
  })

  it('throws on a nonzero exit', async () => {
    const box = fakeBox({ onExec: () => fakeRun({ exitCode: 1 }) })
    await expect(refreshGitCredentials(box, 't')).rejects.toThrow(/Failed to refresh GitHub credentials/)
  })
})

describe('getAheadCount', () => {
  it('runs rev-list against origin/<branch>', async () => {
    const box = gitBox({ ahead: '3' })
    await expect(getAheadCount(box, 'pi/abc')).resolves.toBe(3)
    expect(box.gitCalls.exec[0]).toEqual(['rev-list', '--count', 'origin/pi/abc..HEAD'])
  })

  it('returns undefined on garbage or errors', async () => {
    await expect(getAheadCount(gitBox({ ahead: 'fatal: bad revision' }), 'b')).resolves.toBeUndefined()
    await expect(getAheadCount(gitBox({ ahead: new Error('boom') }), 'b')).resolves.toBeUndefined()
  })
})

describe('pushChanges', () => {
  it('is a no-op when sync is off', async () => {
    const box = gitBox()
    await expect(pushChanges({ ...target(box), syncConfigured: false }, 'tok')).resolves.toEqual({ pushed: false })
    expect(box.gitCalls.push).toHaveLength(0)
  })

  it('treats a missing token as a real failure when configured', async () => {
    await expect(pushChanges(target(gitBox()), undefined)).rejects.toThrow(/gh auth login/)
  })

  it('skips the push and credential refresh when nothing is ahead', async () => {
    const box = gitBox({ ahead: '0' })
    await expect(pushChanges(target(box), 'tok')).resolves.toEqual({ pushed: false })
    expect(box.gitCalls.push).toHaveLength(0)
    expect(box.calls.exec).toHaveLength(0) // no credential refresh either
  })

  it('pushes with a fresh credential when ahead', async () => {
    const box = gitBox({ ahead: '2' })
    await expect(pushChanges(target(box), 'tok')).resolves.toEqual({ pushed: true })
    expect(box.gitCalls.push).toEqual([{ branch: 'pi/abc' }])
    expect(box.calls.exec[0]).toMatch(/git credential approve/) // refreshed before push
  })

  it('still pushes when the ahead count is unknown (never drop work)', async () => {
    const box = gitBox({ ahead: new Error('no upstream yet') })
    await expect(pushChanges(target(box), 'tok')).resolves.toEqual({ pushed: true })
    expect(box.gitCalls.push).toHaveLength(1)
  })

  it('serializes concurrent pushes', async () => {
    const order: string[] = []
    const slow = gitBox({
      onPush: () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            order.push('first')
            resolve()
          }, 30),
        ),
    })
    const fast = gitBox({
      onPush: () => {
        order.push('second')
      },
    })
    await Promise.all([pushChanges(target(slow), 'tok'), pushChanges(target(fast), 'tok')])
    expect(order).toEqual(['first', 'second'])
  })

  it('does not let a failed push poison the queue', async () => {
    const failing = gitBox({
      onPush: () => {
        throw new Error('push exploded')
      },
    })
    await expect(pushChanges(target(failing), 'tok')).rejects.toThrow(/push exploded/)
    await expect(pushChanges(target(gitBox()), 'tok')).resolves.toEqual({ pushed: true })
  })
})
