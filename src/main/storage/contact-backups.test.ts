import { afterEach, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContactBackups } from './contact-backups'

const cleanup: (() => void)[] = []
afterEach(() => { for (const fn of cleanup.splice(0).reverse()) fn() })
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'chouyu-backup-'))
  const tasks = new Database(join(directory, 'agents.db')), checkpoints = new Database(join(directory, 'checkpoints.db'))
  cleanup.push(() => { if (tasks.open) tasks.close(); if (checkpoints.open) checkpoints.close(); rmSync(directory, { recursive: true, force: true }) })
  tasks.pragma('journal_mode=WAL'); checkpoints.pragma('journal_mode=WAL')
  tasks.exec("CREATE TABLE profiles(character_id TEXT PRIMARY KEY); CREATE TABLE runs(id TEXT PRIMARY KEY,character_id TEXT REFERENCES profiles(character_id)); INSERT INTO profiles VALUES('alice'); INSERT INTO runs VALUES('run','alice');")
  checkpoints.exec("CREATE TABLE checkpoints(thread_id TEXT); INSERT INTO checkpoints VALUES('run')")
  const backups = new ContactBackups(directory, { tasks, checkpoints }, operation => operation())
  return { directory, tasks, checkpoints, backups }
}
it('publishes both committed WAL snapshots with validated hashes', async () => {
  const { directory, tasks, backups } = fixture()
  tasks.prepare('INSERT INTO runs VALUES(?,?)').run('later', 'alice')
  const group = await backups.create()
  expect(backups.list().map(item => item.id)).toEqual([group.id])
  const read = new Database(join(directory, 'backups', group.id, 'tasks.db'), { readonly: true })
  try { expect(read.prepare('SELECT id FROM runs ORDER BY id').all()).toEqual([{ id: 'later' }, { id: 'run' }]) }
  finally { read.close() }
  expect(group.files.tasks.sha256).toMatch(/^[a-f0-9]{64}$/)
  expect(group.files.checkpoints.sha256).toMatch(/^[a-f0-9]{64}$/)
})
it('rejects damaged or incomplete groups and keeps the previous verified snapshot', async () => {
  const { directory, checkpoints, tasks, backups } = fixture()
  const first = await backups.create()
  checkpoints.close()
  await expect(backups.create()).rejects.toThrow()
  expect(backups.list().map(item => item.id)).toEqual([first.id])
  tasks.prepare('INSERT INTO runs VALUES(?,?)').run('still-writable', 'alice')
  const partial = join(directory, 'backups', 'partial'); mkdirSync(partial)
  writeFileSync(join(partial, 'tasks.db'), 'partial data')
  expect(backups.list()).toHaveLength(1)
  const file = join(directory, 'backups', first.id, 'tasks.db')
  const bytes = readFileSync(file); bytes[bytes.length - 1] ^= 1; writeFileSync(file, bytes)
  expect(backups.list()).toHaveLength(0)
  expect(() => backups.verify(first.id)).toThrow()
})
it('keeps only three complete generations without removing unrelated files', async () => {
  const { directory, backups } = fixture()
  const ids: string[] = []
  for (let i = 0; i < 4; i++) ids.push((await backups.create()).id)
  expect(new Set(backups.list().map(item => item.id))).toEqual(new Set(ids.slice(1)))
  expect(readFileSync(join(directory, 'agents.db')).length).toBeGreaterThan(0)
  expect(() => backups.verify('../agents.db')).toThrow()
})
it('refuses a checkpoint belonging to a missing task run', async () => {
  const { checkpoints, backups } = fixture()
  checkpoints.prepare('INSERT INTO checkpoints VALUES(?)').run('orphan')
  await expect(backups.create()).rejects.toThrow(/检查点/)
  expect(backups.list()).toHaveLength(0)
})
