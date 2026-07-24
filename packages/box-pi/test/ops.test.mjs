import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fakeBox, fakeRun, fakeStream, load } from './_load.mjs'

const { backgroundSafe, createBashOps, createEditOps, createLsOps, createReadOps, createWriteOps } =
  await load('src/ops.ts')

// --- backgroundSafe ---

test('backgroundSafe redirects to a temp file and re-raises the exit code', () => {
  const cmd = backgroundSafe('server &')
  assert.match(cmd, /mktemp/)
  assert.match(cmd, /\( server &\n\)/) // newline terminates the trailing &
  assert.match(cmd, /cat "\$__pi_out"/)
  assert.match(cmd, /exit \$__pi_rc/)
})

// --- bash ops ---

test('bash exec streams through backgroundSafe with the tool cwd', async () => {
  const box = fakeBox({
    onStream: () =>
      fakeStream([
        { type: 'output', data: 'out' },
        { type: 'exit', exitCode: 0, cpuNs: 1 },
      ]),
  })
  const ops = createBashOps(box)
  const datas = []
  const res = await ops.exec('echo out', '/workspace/home/api', {
    onData: (b) => datas.push(b.toString()),
    signal: undefined,
    timeout: undefined,
  })
  assert.equal(res.exitCode, 0)
  assert.equal(datas.join(''), 'out')
  const sent = box.calls.stream[0]
  assert.match(sent, /^cd '\/workspace\/home\/api' && \(/) // cwd baked into the command
  assert.match(sent, /mktemp/) // backgroundSafe applied
})

test('bash exec wraps the user command with coreutils timeout', async () => {
  const box = fakeBox({
    onStream: () => fakeStream([{ type: 'exit', exitCode: 124, cpuNs: 1 }]),
  })
  const ops = createBashOps(box)
  const res = await ops.exec('sleep 60', '/w', { onData: () => {}, signal: undefined, timeout: 2000 })
  assert.equal(res.exitCode, 124)
  assert.match(box.calls.stream[0], /timeout 2 sh -c 'sleep 60'/)
})

test('bash exec cwdOverride wins over the caller cwd (user ! commands)', async () => {
  const box = fakeBox({ onStream: () => fakeStream([{ type: 'exit', exitCode: 0, cpuNs: 1 }]) })
  const ops = createBashOps(box, '/workspace/home/api')
  await ops.exec('ls', '/host/path/that/does/not/exist', { onData: () => {}, signal: undefined, timeout: undefined })
  assert.match(box.calls.stream[0], /^cd '\/workspace\/home\/api' && \(/)
})

test('bash exec rejects a pre-aborted signal without contacting the box', async () => {
  const box = fakeBox()
  const ops = createBashOps(box)
  const ac = new AbortController()
  ac.abort()
  await assert.rejects(
    () => ops.exec('ls', '/w', { onData: () => {}, signal: ac.signal, timeout: undefined }),
    /aborted/,
  )
  assert.equal(box.calls.stream.length, 0)
})

// --- read ops ---

test('readFile decodes base64 to a Buffer', async () => {
  const box = fakeBox()
  box.files.read = async (path, opts) => {
    assert.equal(path, '/w/f.txt')
    assert.deepEqual(opts, { encoding: 'base64' })
    return Buffer.from('héllo').toString('base64')
  }
  const ops = createReadOps(box)
  const buf = await ops.readFile('/w/f.txt')
  assert.ok(Buffer.isBuffer(buf))
  assert.equal(buf.toString('utf8'), 'héllo')
})

test('access throws when the file is not readable', async () => {
  const box = fakeBox({ onExec: () => fakeRun({ exitCode: 1 }) })
  await assert.rejects(() => createReadOps(box).access('/w/nope'), /not readable/)
})

test('detectImageMimeType recognizes known image types only', async () => {
  const png = fakeBox({ onExec: () => fakeRun({ stdout: 'image/png\n' }) })
  assert.equal(await createReadOps(png).detectImageMimeType('/w/a.png'), 'image/png')
  const txt = fakeBox({ onExec: () => fakeRun({ stdout: 'text/plain\n' }) })
  assert.equal(await createReadOps(txt).detectImageMimeType('/w/a.txt'), null)
  const broken = fakeBox({
    onExec: () => {
      throw new Error('no file util')
    },
  })
  broken.getStatus = async () => ({ status: 'running' })
  assert.equal(await createReadOps(broken).detectImageMimeType('/w/a'), null)
})

// --- write ops ---

test('writeFile forwards path and content', async () => {
  const box = fakeBox()
  const writes = []
  box.files.write = async (opts) => writes.push(opts)
  await createWriteOps(box).writeFile('/w/new.txt', 'content')
  assert.deepEqual(writes, [{ path: '/w/new.txt', content: 'content' }])
})

test('mkdir surfaces failures', async () => {
  const box = fakeBox({ onExec: (cmd) => fakeRun({ exitCode: cmd.includes('mkdir') ? 1 : 0 }) })
  await assert.rejects(() => createWriteOps(box).mkdir('/w/dir'), /Failed to create directory/)
})

// --- edit ops ---

test('edit ops read+write roundtrip preserves content', async () => {
  const box = fakeBox({ onExec: () => fakeRun({ exitCode: 0 }) })
  const store = { '/w/f.ts': 'const a = 1\n' }
  box.files.read = async (path) => Buffer.from(store[path], 'utf8').toString('base64')
  box.files.write = async ({ path, content }) => {
    store[path] = content
  }
  const ops = createEditOps(box)
  await ops.access('/w/f.ts')
  const buf = await ops.readFile('/w/f.ts')
  await ops.writeFile('/w/f.ts', buf.toString('utf8').replace('1', '2'))
  assert.equal(store['/w/f.ts'], 'const a = 2\n')
})

// --- ls ops ---

test('ls ops: exists, stat, readdir', async () => {
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
  assert.equal(await ops.exists('/w/a.txt'), true)
  assert.equal(await ops.exists('/w/missing'), false)
  assert.equal((await ops.stat('/w/dir')).isDirectory(), true)
  assert.equal((await ops.stat('/w/file')).isDirectory(), false)
  assert.deepEqual(await ops.readdir('/w'), ['a.txt', '.hidden', 'sub'])
})

test('ls stat throws for a missing path', async () => {
  const box = fakeBox({ onExec: () => fakeRun({ exitCode: 1 }) })
  await assert.rejects(() => createLsOps(box).stat('/w/none'), /Path not found/)
})
