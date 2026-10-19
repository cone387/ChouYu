import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { writeSoakReport } from './soak-report-file'

async function holdReader(file: string) {
  const script = `$stream = [IO.File]::Open('${file.replaceAll("'", "''")}', [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
try { [Console]::WriteLine('locked'); [Console]::Out.Flush(); $null = [Console]::ReadLine() } finally { $stream.Dispose() }`
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const exited = new Promise<void>((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(Error(`Reader exited ${code}`))) })
  await Promise.race([new Promise<void>(resolve => child.stdout.once('data', () => resolve())), exited.then(() => { throw Error('Reader exited before locking') })])
  return async () => { child.stdin.end('\n'); await exited }
}

it('atomically publishes complete JSON', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'soak-report-'))
  try {
    const file = join(directory, 'report.json')
    await writeSoakReport(file, { samples: 1, body: '正文' })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ samples: 1, body: '正文' })
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it.skipIf(process.platform !== 'win32')('publishes after an actual Windows reader releases its temporary lock', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'soak-report-'))
  let release: (() => Promise<void>) | undefined
  try {
    const file = join(directory, 'report.json')
    await writeFile(file, JSON.stringify({ samples: 1 }))
    release = await holdReader(file)
    const unlocked = new Promise<void>((resolve, reject) => setTimeout(() => release!().then(resolve, reject), 75))
    try { await expect(writeSoakReport(file, { samples: 2 })).resolves.toBeUndefined() } finally { await unlocked; release = undefined }
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ samples: 2 })
  } finally { await release?.(); await rm(directory, { recursive: true, force: true }) }
}, 10000)

it.skipIf(process.platform !== 'win32')('reports a sustained lock within a finite deadline and preserves the previous report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'soak-report-'))
  let release: (() => Promise<void>) | undefined
  try {
    const file = join(directory, 'report.json')
    await writeFile(file, JSON.stringify({ samples: 1 }))
    release = await holdReader(file)
    const began = Date.now()
    await expect(writeSoakReport(file, { samples: 2 })).rejects.toMatchObject({ code: 'EPERM' })
    expect(Date.now() - began).toBeLessThan(2000)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ samples: 1 })
    expect(JSON.parse(await readFile(file + '.tmp', 'utf8'))).toEqual({ samples: 2 })
  } finally { await release?.(); await rm(directory, { recursive: true, force: true }) }
}, 10000)

it('propagates a missing output directory instead of claiming a saved report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'soak-report-'))
  try { await expect(writeSoakReport(join(directory, 'missing', 'report.json'), {})).rejects.toMatchObject({ code: 'ENOENT' }) }
  finally { await rm(directory, { recursive: true, force: true }) }
})
