import { afterEach, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { openApplicationDatabase, type ApplicationDatabase } from './application-database'
import { findTextMatch, searchableMessageText } from '../../shared/conversation-search'
import type { ChatSession } from '../../shared/conversations'
const close: (() => Promise<void>)[] = []
afterEach(async () => { for (const f of close.splice(0)) await f() })
function fixture(): ApplicationDatabase {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chouyu-query-')), app = openApplicationDatabase(dir)
  close.push(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }) })
  return app
}
function session(): ChatSession { return { id: 's', title: 'Example', characterId: 'a', createdAt: 1, updatedAt: 1, messages: Array.from({ length: 9 }, (_, i) => ({ id: `m${i}`, role: 'user', content: `历史${i} K Σ σ ς`, timestamp: i })) } }
it('pages with position and ID across append/content edits; rejects a displaced boundary', () => {
  const app = fixture(), s = session(); app.conversations.saveSession(s)
  const page = app.conversations.readMessages('s', undefined, 3)
  expect(page.messages.map(m => m.id)).toEqual(['m6', 'm7', 'm8'])
  s.messages.push({ id: 'm9', role: 'user', content: 'new', timestamp: 9 }); s.messages[3].content = 'edited'
  app.conversations.saveSession(s)
  const earlier = app.conversations.readMessages('s', page.before!, 3)
  expect(earlier.messages.map(m => m.id)).toEqual(['m3', 'm4', 'm5'])
  expect(earlier.messages[0].content).toBe('edited')
  s.messages.splice(0, 1); app.conversations.saveSession(s)
  expect(() => app.conversations.readMessages('s', page.before!, 3)).toThrow('changed')
})
it('searches exact Unicode substrings including tool fragments without reading full sessions', () => {
  const app = fixture(), s = session()
  s.messages[0].toolData = { displayName: 'Tool', summary: 'result', status: 'completed', name: 'example', id: 't' } as never
  app.conversations.saveSession(s)
  app.conversations.readSession = () => { throw new Error('full hydration') }
  expect(app.conversations.listMetadata()[0].summary.messageCount).toBe(9)
  for (const query of ['k', 'Σ', 'ς', '历史3', 'ς\nTool\nres', 'missing']) {
    const expected = s.messages.find(m => findTextMatch(searchableMessageText(m), query))
    expect(app.conversations.search(query).map(row => row.id)).toEqual(expected ? ['s'] : [])
  }
})

it('migrates search/projections atomically and retries a failed version-one upgrade', async () => {
  const app = fixture(), filename = app.filename
  app.conversations.saveSession(session()); await app.close()
  const old = new Database(filename)
  old.exec("ALTER TABLE sessions DROP COLUMN projection; ALTER TABLE messages DROP COLUMN search_text; PRAGMA user_version=1; CREATE TRIGGER fail BEFORE UPDATE ON messages BEGIN SELECT RAISE(ABORT,'upgrade locked'); END")
  old.close()
  expect(() => openApplicationDatabase(path.dirname(filename))).toThrow('upgrade locked')
  const preserved = new Database(filename)
  expect(preserved.pragma('user_version', { simple: true })).toBe(1)
  expect((preserved.pragma('table_info(messages)') as { name: string }[]).some(column => column.name === 'search_text')).toBe(false)
  preserved.exec('DROP TRIGGER fail'); preserved.close()
  const upgraded = openApplicationDatabase(path.dirname(filename))
  try {
    expect(upgraded.db.pragma('user_version', { simple: true })).toBe(2)
    expect(upgraded.conversations.search('历史3')).toHaveLength(1)
    expect(upgraded.conversations.readSession('s')).toEqual(session())
  } finally { await upgraded.close() }
})
