/**
 * Copyright Upstash, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Live end-to-end: exercise the extension's ops layer against a real Upstash
 * Box — bash (streaming), file read/write (text + binary), ls, find, grep, and
 * a preview URL. Needs UPSTASH_BOX_API_KEY.
 */

import { assert, createTestBox, load } from './_live.mjs'

const { createBashOps, createLsOps, createReadOps, createWriteOps } = await load('src/ops.ts')
const { runRemoteFind } = await load('src/find-tool.ts')
const { runRemoteGrep } = await load('src/grep-tool.ts')

const WORKDIR = '/workspace/home'

const { box, cleanup } = await createTestBox('pi-live-basic')
try {
  // --- bash (streaming exec) ---
  const bash = createBashOps(box)
  let out = ''
  const res = await bash.exec('echo hello-from-box && uname -a', WORKDIR, {
    onData: (b) => (out += b.toString()),
    signal: undefined,
    timeout: undefined,
  })
  assert(res.exitCode === 0, `bash exit code 0 (got ${res.exitCode})`)
  assert(out.includes('hello-from-box'), `bash output captured (got: ${out.slice(0, 200)})`)
  console.log('✓ bash exec streams output and exit code')

  // Nonzero exit codes surface as-is.
  const fail = await bash.exec('exit 7', WORKDIR, { onData: () => {}, signal: undefined, timeout: undefined })
  assert(fail.exitCode === 7, `bash exit code preserved (got ${fail.exitCode})`)
  console.log('✓ bash exit codes preserved')

  // --- files: text + binary roundtrip ---
  const writeOps = createWriteOps(box)
  const readOps = createReadOps(box)
  await writeOps.mkdir(`${WORKDIR}/sub/dir`)
  await writeOps.writeFile(`${WORKDIR}/sub/dir/hello.txt`, 'héllo wörld\n')
  const text = await readOps.readFile(`${WORKDIR}/sub/dir/hello.txt`)
  assert(text.toString('utf8') === 'héllo wörld\n', 'text file roundtrip (utf8 preserved)')
  console.log('✓ text file write/read roundtrip')

  // Binary: a tiny PNG header must survive the base64 transport.
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0xff])
  await bash.exec(
    `printf '\\211PNG\\r\\n\\032\\n\\000\\001\\002\\377' > ${WORKDIR}/img.png`,
    WORKDIR,
    { onData: () => {}, signal: undefined, timeout: undefined },
  )
  const bin = await readOps.readFile(`${WORKDIR}/img.png`)
  assert(Buffer.compare(bin, png) === 0, `binary read is byte-exact (got ${bin.toString('hex')})`)
  console.log('✓ binary file read is byte-exact')

  // --- ls ops ---
  const lsOps = createLsOps(box)
  assert((await lsOps.exists(`${WORKDIR}/sub/dir/hello.txt`)) === true, 'exists: file')
  assert((await lsOps.exists(`${WORKDIR}/nope`)) === false, 'exists: missing')
  assert((await lsOps.stat(`${WORKDIR}/sub`)).isDirectory() === true, 'stat: directory')
  assert((await lsOps.stat(`${WORKDIR}/img.png`)).isDirectory() === false, 'stat: file')
  const entries = await lsOps.readdir(`${WORKDIR}/sub`)
  assert(entries.includes('dir'), `readdir lists entries (got ${JSON.stringify(entries)})`)
  console.log('✓ ls ops (exists/stat/readdir)')

  // --- find + grep ---
  await writeOps.writeFile(`${WORKDIR}/sub/needle.ts`, 'export const NEEDLE = 42\n')
  const found = await runRemoteFind(box, WORKDIR, { pattern: '*.ts' })
  assert(found.content[0].text.includes('sub/needle.ts'), `find locates the file (got: ${found.content[0].text})`)
  console.log('✓ find (in-box glob search)')

  const grepped = await runRemoteGrep(box, WORKDIR, { pattern: 'NEEDLE', path: 'sub' })
  assert(grepped.content[0].text.includes('needle.ts'), `grep finds the match (got: ${grepped.content[0].text})`)
  const noMatch = await runRemoteGrep(box, WORKDIR, { pattern: 'DEFINITELY_ABSENT_9f8e7d' })
  assert(noMatch.content[0].text.includes('No matches found'), 'grep no-match message')
  console.log('✓ grep (in-box content search)')

  // --- preview URL (basic-auth protected, matching the preview_url tool) ---
  const preview = await box.getPublicURL(8080, { basicAuth: true })
  assert(typeof preview.url === 'string' && preview.url.startsWith('http'), `preview url shape (got ${preview.url})`)
  assert(Boolean(preview.username && preview.password), 'preview returns basic-auth credentials')
  console.log(`✓ preview URL created (basic auth): ${preview.url}`)

  console.log('\nlive-basic passed.')
} finally {
  await cleanup()
}
