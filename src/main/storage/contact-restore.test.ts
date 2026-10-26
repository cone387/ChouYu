import { expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ContactBackups } from './contact-backups'
import { ContactRestore, inspectContactStorage } from './contact-restore'

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'contact-restore-'))
  const tasks = new Database(join(directory, 'agents.db')), checkpoints = new Database(join(directory, 'checkpoints.db'))
  tasks.exec("CREATE TABLE profiles(id TEXT); CREATE TABLE runs(id TEXT); INSERT INTO runs VALUES('saved')")
  checkpoints.exec("CREATE TABLE checkpoints(thread_id TEXT); INSERT INTO checkpoints VALUES('saved')")
  const group = await new ContactBackups(directory, { tasks, checkpoints }).create()
  tasks.close(); checkpoints.close()
  writeFileSync(join(directory, 'agents.db'), 'damaged original')
  return { directory, group }
}
it.each(['prepared', 'preserved:agents.db', 'preserved:checkpoints.db', 'publishing', 'published:agents.db', 'published:checkpoints.db'])('resumes an interrupted paired restore at %s while retaining originals', async fault => {
  const { directory, group } = await fixture()
  let protectedGroup = ''
  try {
    const restore = new ContactRestore(directory, id => { protectedGroup = id }, phase => { if (phase === fault) throw new Error('power loss') })
    expect(() => restore.restore(group.id)).toThrow('power loss')
    expect(protectedGroup).toBe(group.id)
    const resumed = new ContactRestore(directory, () => {})
    resumed.resume()
    expect(inspectContactStorage(directory).kind).toBe('healthy')
    const db = new Database(join(directory, 'agents.db'))
    try { expect(db.prepare('SELECT id FROM runs').get()).toEqual({ id: 'saved' }) } finally { db.close() }
    const record = JSON.parse(readFileSync(join(directory, 'restore.json'), 'utf8'))
    expect(readFileSync(join(directory, 'recovery', record.id, 'original', 'agents.db'), 'utf8')).toBe('damaged original')
    expect(record.phase).toBe('complete')
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
it('does not replace healthy or newer-schema databases and never creates an empty missing pair', async () => {
  const { directory, group } = await fixture()
  try {
    expect(inspectContactStorage(directory).kind).toBe('damaged')
    new ContactRestore(directory, () => {}).restore(group.id)
    expect(() => new ContactRestore(directory, () => {}).restore(group.id)).toThrow(/损坏|缺失/)
    const db = new Database(join(directory, 'agents.db')); db.pragma('user_version=999'); db.close()
    expect(inspectContactStorage(directory).kind).toBe('incompatible')
    expect(() => new ContactRestore(directory, () => {}).restore(group.id)).toThrow()
    rmSync(join(directory, 'agents.db'))
    expect(inspectContactStorage(directory).kind).toBe('missing')
    expect(existsSync(join(directory, 'agents.db'))).toBe(false)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
it('does not mistake an inaccessible peer database or a newer peer for repairable corruption', async () => {
  const { directory, group } = await fixture()
  try {
    const checkpointPath = join(directory, 'checkpoints.db')
    const db = new Database(checkpointPath); db.pragma('user_version=999'); db.close()
    expect(inspectContactStorage(directory).kind).toBe('incompatible')
    expect(() => new ContactRestore(directory, () => {}).restore(group.id)).toThrow()
    rmSync(checkpointPath); mkdirSync(checkpointPath)
    expect(inspectContactStorage(directory).kind).toBe('unavailable')
    expect(() => new ContactRestore(directory, () => {}).restore(group.id)).toThrow()
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
