import { expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { initializeContactStorage, openContactDatabase } from '../storage/contact-database'

it.skipIf(process.platform !== 'win32').each([true, false])('bounds recovery of an actual Windows SHM mapping (released=%s)', async released => {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-wal-mapping-')), file = join(dir, 'agents.db')
  const seed = openContactDatabase(file, 'tasks')
  seed.exec('CREATE TABLE proof(value TEXT); INSERT INTO proof VALUES(\'saved\')')
  const database = readFileSync(file), wal = readFileSync(file + '-wal')
  seed.close()
  // Preserve the exact consistent main/WAL pair from before close (no concurrent writer).
  writeFileSync(file, database); writeFileSync(file + '-wal', wal)
  writeFileSync(file + '-shm', Buffer.alloc(32768))
  const script = "$ErrorActionPreference='Stop'; $s=[IO.FileStream]::new($env:CHOUYU_MAPPING_FIXTURE,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)); $m=[IO.MemoryMappedFiles.MemoryMappedFile]::CreateFromFile($s,([Guid]::NewGuid().ToString()),0,[IO.MemoryMappedFiles.MemoryMappedFileAccess]::ReadWrite,[IO.HandleInheritability]::None,$true); $v=$m.CreateViewAccessor(); $s.Dispose(); [Console]::WriteLine('mapped'); [Console]::ReadLine() | Out-Null; $v.Dispose(); $m.Dispose()"
  const child = spawn('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true, env: { ...process.env, CHOUYU_MAPPING_FIXTURE: file + '-shm' }, stdio: ['pipe', 'pipe', 'pipe'] })
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Mapping fixture startup timed out')), 10000)
      child.stdout!.on('data', data => { if (String(data).includes('mapped')) { clearTimeout(timer); resolve() } })
      child.once('error', reject)
      child.stderr!.on('data', data => { clearTimeout(timer); reject(new Error(String(data))) })
      child.once('exit', code => { if (code) { clearTimeout(timer); reject(new Error('Mapping fixture exited: ' + code)) } })
    })
    let failure: unknown
    try { openContactDatabase(file, 'tasks').close() } catch (error) { failure = error }
    expect(failure).toMatchObject({ code: 'SQLITE_IOERR_TRUNCATE', phase: 'wal', database: 'tasks' })
    const retries: unknown[] = []
    const recovering = initializeContactStorage(() => openContactDatabase(file, 'tasks'), event => {
      retries.push(event); if (released) child.stdin!.end('\n')
    })
    if (!released) {
      await expect(recovering).rejects.toMatchObject({ code: 'SQLITE_IOERR_TRUNCATE', phase: 'wal' })
      expect(retries).toHaveLength(3)
      child.stdin!.end('\n'); await exited
    }
    const reopened = released ? await recovering : openContactDatabase(file, 'tasks')
    await exited
    expect(retries[0]).toMatchObject({ attempt: 1, storage: { code: 'SQLITE_IOERR_TRUNCATE', phase: 'wal', database: 'tasks' } })
    try { expect(reopened.prepare('SELECT * FROM proof').all()).toEqual([{ value: 'saved' }]); expect(reopened.pragma('integrity_check', { simple: true })).toBe('ok') }
    finally { reopened.close() }
  } finally { child.stdin!.end('\n'); child.kill(); await exited; try { rmSync(dir, { recursive: true, force: true }) } catch { /* Retain a failed native fixture until its worker exits. */ } }
}, 20000)

it('does not retry a corrupt database or alter its contents', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-wal-corrupt-')), file = join(dir, 'agents.db'), content = 'invalid database'.repeat(100)
  writeFileSync(file, content)
  const retries: unknown[] = []
  try {
    await expect(initializeContactStorage(() => openContactDatabase(file, 'tasks'), event => retries.push(event))).rejects.toMatchObject({ code: 'SQLITE_NOTADB' })
    expect(retries).toEqual([]); expect(readFileSync(file, 'utf8')).toBe(content)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
