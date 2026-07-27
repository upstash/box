import { describe, expect, it } from 'vitest'
import {
  backgroundSafe,
  createBashOps,
  createEditOps,
  createLsOps,
  createReadOps,
  createWriteOps,
} from '../src/ops.ts'
import { type FakeBox, fakeBox, fakeRun, fakeStream } from './helpers.ts'

describe('backgroundSafe', () => {
  it('redirects to a temp file and re-raises the exit code', () => {
    const cmd = backgroundSafe('server &')
    expect(cmd).toMatch(/mktemp/)
    expect(cmd).toMatch(/\( server &\n\)/) // newline terminates the trailing &
    expect(cmd).toMatch(/cat "\$__pi_out"/)
    expect(cmd).toMatch(/exit \$__pi_rc/)
  })
})

describe('bash ops', () => {
  it('streams through backgroundSafe with the tool cwd', async () => {
    const box = fakeBox({
      onStream: () =>
        fakeStream([
          { type: 'output', data: 'out' },
          { type: 'exit', exitCode: 0, cpuNs: 1 },
        ]),
    })
    const ops = createBashOps(box)
    const datas: string[] = []
    const res = await ops.exec('echo out', '/workspace/home/api', {
      onData: (b) => datas.push(b.toString()),
      signal: undefined,
      timeout: undefined,
    })
    expect(res.exitCode).toBe(0)
    expect(datas.join('')).toBe('out')
    const sent = box.calls.stream[0]
    expect(sent).toMatch(/^cd '\/workspace\/home\/api' && \(/) // cwd baked into the command
    expect(sent).toMatch(/mktemp/) // backgroundSafe applied
  })

  it('wraps the user command with coreutils timeout', async () => {
    const box = fakeBox({
      onStream: () => fakeStream([{ type: 'exit', exitCode: 124, cpuNs: 1 }]),
    })
    const ops = createBashOps(box)
    const res = await ops.exec('sleep 60', '/w', { onData: () => {}, signal: undefined, timeout: 2000 })
    expect(res.exitCode).toBe(124)
    expect(box.calls.stream[0]).toMatch(/timeout 2 sh -c 'sleep 60'/)
  })

  it('lets cwdOverride win over the caller cwd (user ! commands)', async () => {
    const box = fakeBox({ onStream: () => fakeStream([{ type: 'exit', exitCode: 0, cpuNs: 1 }]) })
    const ops = createBashOps(box, '/workspace/home/api')
    await ops.exec('ls', '/host/path/that/does/not/exist', {
      onData: () => {},
      signal: undefined,
      timeout: undefined,
    })
    expect(box.calls.stream[0]).toMatch(/^cd '\/workspace\/home\/api' && \(/)
  })

  it('rejects a pre-aborted signal without contacting the box', async () => {
    const box = fakeBox()
    const ops = createBashOps(box)
    const ac = new AbortController()
    ac.abort()
    await expect(
      ops.exec('ls', '/w', { onData: () => {}, signal: ac.signal, timeout: undefined }),
    ).rejects.toThrow(/aborted/)
    expect(box.calls.stream).toHaveLength(0)
  })
})

describe('read ops', () => {
  it('decodes base64 to a Buffer', async () => {
    const box = fakeBox()
    box.files.read = async (path, opts) => {
      expect(path).toBe('/w/f.txt')
      expect(opts).toEqual({ encoding: 'base64' })
      return Buffer.from('héllo').toString('base64')
    }
    const buf = await createReadOps(box).readFile('/w/f.txt')
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.toString('utf8')).toBe('héllo')
  })

  it('throws from access when the file is not readable', async () => {
    const box = fakeBox({ onExec: () => fakeRun({ exitCode: 1 }) })
    await expect(createReadOps(box).access('/w/nope')).rejects.toThrow(/not readable/)
  })

  // `detectImageMimeType` is optional on Pi's ReadOperations; ours always has it.
  const detectMime = (box: FakeBox) => {
    const detect = createReadOps(box).detectImageMimeType
    if (!detect) throw new Error('createReadOps must provide detectImageMimeType')
    return detect
  }

  it('recognizes known image types only', async () => {
    const png = fakeBox({ onExec: () => fakeRun({ stdout: 'image/png\n' }) })
    await expect(detectMime(png)('/w/a.png')).resolves.toBe('image/png')

    const txt = fakeBox({ onExec: () => fakeRun({ stdout: 'text/plain\n' }) })
    await expect(detectMime(txt)('/w/a.txt')).resolves.toBeNull()

    const broken = fakeBox({
      onExec: () => {
        throw new Error('no file util')
      },
    })
    await expect(detectMime(broken)('/w/a')).resolves.toBeNull()
  })
})

describe('write ops', () => {
  it('forwards path and content', async () => {
    const box = fakeBox()
    const writes: { path: string; content: string }[] = []
    box.files.write = async (opts) => {
      writes.push(opts as { path: string; content: string })
    }
    await createWriteOps(box).writeFile('/w/new.txt', 'content')
    expect(writes).toEqual([{ path: '/w/new.txt', content: 'content' }])
  })

  it('surfaces mkdir failures', async () => {
    const box = fakeBox({ onExec: (cmd) => fakeRun({ exitCode: cmd.includes('mkdir') ? 1 : 0 }) })
    await expect(createWriteOps(box).mkdir('/w/dir')).rejects.toThrow(/Failed to create directory/)
  })
})

describe('edit ops', () => {
  it('preserves content across a read+write roundtrip', async () => {
    const box = fakeBox({ onExec: () => fakeRun({ exitCode: 0 }) })
    const store: Record<string, string> = { '/w/f.ts': 'const a = 1\n' }
    box.files.read = async (path) => Buffer.from(store[path], 'utf8').toString('base64')
    box.files.write = async ({ path, content }) => {
      store[path] = content
    }
    const ops = createEditOps(box)
    await ops.access('/w/f.ts')
    const buf = await ops.readFile('/w/f.ts')
    await ops.writeFile('/w/f.ts', buf.toString('utf8').replace('1', '2'))
    expect(store['/w/f.ts']).toBe('const a = 2\n')
  })
})

describe('ls ops', () => {
  it('reports exists, stat, and readdir', async () => {
    const box = fakeBox({
      onExec: (cmd) => {
        if (cmd.includes('test -e') && cmd.includes('echo dir')) {
          return cmd.includes("'/w/dir'") ? fakeRun({ stdout: 'dir\n' }) : fakeRun({ stdout: 'other\n' })
        }
        if (cmd.includes('test -e')) return fakeRun({ exitCode: cmd.includes('missing') ? 1 : 0 })
        if (cmd.includes('ls -1A')) return fakeRun({ stdout: 'a.txt\n.hidden\nsub\n' })
        return fakeRun()
      },
    })
    const ops = createLsOps(box)
    await expect(ops.exists('/w/a.txt')).resolves.toBe(true)
    await expect(ops.exists('/w/missing')).resolves.toBe(false)
    expect((await ops.stat('/w/dir')).isDirectory()).toBe(true)
    expect((await ops.stat('/w/file')).isDirectory()).toBe(false)
    await expect(ops.readdir('/w')).resolves.toEqual(['a.txt', '.hidden', 'sub'])
  })

  it('throws from stat for a missing path', async () => {
    const box = fakeBox({ onExec: () => fakeRun({ exitCode: 1 }) })
    await expect(createLsOps(box).stat('/w/none')).rejects.toThrow(/Path not found/)
  })
})
