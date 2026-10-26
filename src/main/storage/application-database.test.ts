import { afterEach, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { openApplicationDatabase } from './application-database'
import { migrateLegacyStore } from './legacy-migration'
import type { ChatSession } from '../../shared/conversations'

const disposals: (() => void | Promise<void>)[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const dispose of disposals.splice(0).reverse()) await dispose() })
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chouyu-application-'))
  disposals.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  const app = openApplicationDatabase(dir)
  disposals.push(() => app.close())
  return { dir, app }
}
const session = (): ChatSession => ({ id: 's', title: 'Saved', characterId: 'alice', createdAt: 1, updatedAt: 2, lastReadAt: 1,
  messages: [{ id: 'a', role: 'user', content: 'original', timestamp: 1, imageUrl: 'chouyu-attachment:' + 'a'.repeat(64) + '.png' },
    { id: 'b', role: 'assistant', content: 'body', timestamp: 2, replyCompletedAt: 3, replyReadAt: 3,
      communication: { version: 1, characterId: 'alice', intent: 'reply', source: { kind: 'conversation', sessionId: 's' } } }] })

it('writes only changed rows and keeps receipt plus message atomic on real SQL failure', () => {
  const { app } = fixture(), first = session()
  app.conversations.saveSession(first)
  app.db.exec(`CREATE TABLE observed(id TEXT); CREATE TRIGGER observe AFTER UPDATE ON messages BEGIN INSERT INTO observed VALUES(new.id); END;`)
  app.conversations.saveSession(first)
  app.metadata.set('config', { model: 'changed' })
  expect(app.db.prepare('SELECT * FROM observed').all()).toEqual([])
  first.messages[1].content = 'edited'
  app.conversations.saveSession(first)
  expect(app.db.prepare('SELECT * FROM observed').all()).toEqual([{ id: 'b' }])
  app.db.exec("CREATE TRIGGER fail BEFORE INSERT ON messages WHEN new.id='c' BEGIN SELECT RAISE(ABORT,'disk full'); END")
  expect(() => app.conversations.appendDelivered({ sessionId: 's', message: { id: 'c', role: 'assistant', content: 'pending', timestamp: 4 }, receiptKeys: ['agent-notice:alice:one'] })).toThrow('disk full')
  expect(app.metadata.getState('agent-notice:alice:one')).toBeNull()
  expect(app.conversations.readSession('s')!.messages).toHaveLength(2)
  app.db.exec('DROP TRIGGER fail')
  const input = { sessionId: 's', message: { id: 'c', role: 'assistant' as const, content: 'pending', timestamp: 4 }, receiptKeys: ['agent-notice:alice:one'] }
  app.conversations.appendDelivered(input); app.conversations.appendDelivered(input)
  expect(app.conversations.readSession('s')!.messages).toHaveLength(3)
  expect(app.metadata.getState(input.receiptKeys[0])).toBe('delivered')
})

it('marks the requested message boundary with both creation and completion timestamps', () => {
  const { app } = fixture(), value = session()
  value.messages[1].timestamp = 20
  value.messages.push({ id: 'later', role: 'assistant', content: 'unseen', timestamp: 30 })
  app.conversations.saveSession(value)
  app.conversations.markRead('s', 'b')
  expect(app.conversations.readSession('s')!.lastReadAt).toBe(20)
})

it('rolls back an incomplete import and preserves every message field and order on retry', () => {
  const { app, dir } = fixture(), value = { sessions: [session()], activeSessionId: 's', config: { apiKey: 'safe:v1:encrypted' }, characters: [], state: { 'reminder-receipt:one': 'delivered' } }
  const source = path.join(dir, 'chouyu-data.json'), text = JSON.stringify({ version: 4, ...value })
  fs.writeFileSync(source, text)
  app.db.exec("CREATE TRIGGER fail BEFORE INSERT ON messages WHEN new.id='b' BEGIN SELECT RAISE(ABORT,'disk full'); END")
  expect(() => migrateLegacyStore(dir, app, value)).toThrow('disk full')
  expect(app.conversations.listSessions()).toEqual([])
  expect(app.metadata.get('migration')).toBeNull()
  expect(fs.readFileSync(source, 'utf8')).toBe(text)
  app.db.exec('DROP TRIGGER fail')
  migrateLegacyStore(dir, app, value)
  expect(app.conversations.readSession('s')).toEqual(session())
  expect(app.metadata.getState('reminder-receipt:one')).toBe('delivered')
  expect(JSON.parse(fs.readFileSync(source, 'utf8')).version).toBe(5)
  expect(fs.readFileSync(source + '.legacy', 'utf8')).toBe(text)
})

it('retries the old-version barrier after DB commit without importing twice or overwriting new data', () => {
  const { app, dir } = fixture(), value = { sessions: [session()], activeSessionId: 's', config: {}, characters: [], state: {} }
  const source = path.join(dir, 'chouyu-data.json')
  fs.writeFileSync(source, JSON.stringify({ version: 4, ...value }))
  const rename = fs.renameSync.bind(fs)
  const failure = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => { if (to === source) throw new Error('locked'); rename(from, to) })
  expect(() => migrateLegacyStore(dir, app, value)).toThrow('locked')
  expect(app.metadata.get('migration')).not.toBeNull()
  failure.mockRestore()
  migrateLegacyStore(dir, app, value)
  expect(app.conversations.listSessions()).toHaveLength(1)
  expect(app.conversations.readSession('s')!.messages).toHaveLength(2)
  expect(JSON.parse(fs.readFileSync(source, 'utf8')).version).toBe(5)
})

it('keeps a consistent verified backup and recovers the exact saved boundary with a visible notice', async () => {
  const { app, dir } = fixture()
  app.conversations.saveSession(session())
  await app.backup()
  const backup = fs.readFileSync(path.join(dir, 'chouyu-application.db.bak'))
  const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('locked') })
  app.metadata.set('config', { model: 'later' })
  await expect(app.backup()).rejects.toThrow('locked')
  expect(fs.readFileSync(path.join(dir, 'chouyu-application.db.bak'))).toEqual(backup)
  rename.mockRestore(); await app.close()
  fs.writeFileSync(path.join(dir, 'chouyu-application.db'), 'broken')
  const restored = openApplicationDatabase(dir)
  disposals.push(() => restored.close())
  expect(restored.notice).toContain('备份')
  expect(restored.conversations.readSession('s')).toEqual(session())
  expect(restored.metadata.get('config')).toBeNull()
  expect(fs.readdirSync(dir).some(name => name.includes('.corrupt-'))).toBe(true)
})

it('yields during a paged backup, accepts live writes, coalesces calls and closes after publication', async () => {
  const { app, dir } = fixture()
  app.metadata.set('large', 'x'.repeat(4 * 1024 * 1024))
  let turns = 0
  const tick = () => { turns++; if (app.db.open) setImmediate(tick) }
  setImmediate(tick)
  const pending = app.backup()
  expect(pending).toBeInstanceOf(Promise)
  expect(app.backup()).toBe(pending)
  app.metadata.set('during', 'committed')
  const closing = app.close()
  expect(app.db.open).toBe(true)
  await closing
  await pending
  expect(turns).toBeGreaterThan(1)
  expect(app.db.open).toBe(false)
  const copy = new Database(path.join(dir, 'chouyu-application.db.bak'), { readonly: true })
  try { expect(copy.prepare("SELECT value FROM metadata WHERE key='during'").get()).toEqual({ value: '"committed"' }) }
  finally { copy.close() }
})

it('refuses newer SQLite formats and releases a partially initialized handle', () => {
  const { app, dir } = fixture()
  app.db.pragma('user_version = 99'); app.close()
  expect(() => openApplicationDatabase(dir)).toThrow('NEWER_STORE_VERSION')
  const raw = new Database(path.join(dir, 'chouyu-application.db'))
  expect(raw.pragma('user_version', { simple: true })).toBe(99)
  raw.close()
  fs.renameSync(path.join(dir, 'chouyu-application.db'), path.join(dir, 'preserved.db'))
})

it('releases the connection on schema failure and refuses a changed or newer legacy source', () => {
  const { app, dir } = fixture()
  const source = path.join(dir, 'chouyu-data.json')
  fs.writeFileSync(source, JSON.stringify({ version: 99, sessions: [] }))
  expect(() => migrateLegacyStore(dir, app, { sessions: [], config: {}, characters: [], activeSessionId: '', state: {} })).toThrow('NEWER_STORE_VERSION')
  expect(app.metadata.get('migration')).toBeNull()
  app.close()
  const exec = vi.spyOn(Database.prototype, 'exec').mockImplementationOnce(() => { throw new Error('schema failure') })
  expect(() => openApplicationDatabase(dir)).toThrow('schema failure')
  exec.mockRestore()
  fs.renameSync(path.join(dir, 'chouyu-application.db'), path.join(dir, 'released.db'))
})

it('retains a bad backup without silently opening an empty authority', () => {
  const { app, dir } = fixture()
  app.close()
  const filename = path.join(dir, 'chouyu-application.db')
  fs.writeFileSync(filename, 'damaged primary')
  fs.writeFileSync(filename + '.bak', 'damaged backup')
  expect(() => openApplicationDatabase(dir)).toThrow()
  expect(fs.readFileSync(filename + '.bak', 'utf8')).toBe('damaged backup')
  expect(fs.readdirSync(dir).filter(f => f.includes('.corrupt-')).map(f => fs.readFileSync(path.join(dir, f), 'utf8'))).toContain('damaged primary')
})

it('retries interrupted empty initialization without quarantining a valid database', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chouyu-application-'))
  disposals.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  const fail = vi.spyOn(Database.prototype, 'exec').mockImplementationOnce(() => { throw new Error('interrupted schema') })
  expect(() => openApplicationDatabase(dir)).toThrow('interrupted schema')
  fail.mockRestore()
  const app = openApplicationDatabase(dir)
  disposals.push(() => app.close())
  expect(app.conversations.listSessions()).toEqual([])
  expect(fs.readdirSync(dir).some(name => name.includes('.corrupt-'))).toBe(false)
})
