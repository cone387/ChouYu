import type Database from 'better-sqlite3'
import { readStoredDelivery } from './delivery-blocks'
import { randomUUID } from 'node:crypto'
import { validateMemoryInput, type ContactMemory, type MemoryInput } from '../../shared/contact-memories'
import { validId, type ContactReadContext } from '../../shared/contact-content'

export class AgentMemories {
  constructor(private db: Database.Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS contact_memory_records(id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE,value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS contact_memory_owner ON contact_memory_records(owner);
      CREATE TABLE IF NOT EXISTS contact_memory_versions(id TEXT NOT NULL REFERENCES contact_memory_records(id) ON DELETE CASCADE,revision INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(id,revision));
      CREATE TABLE IF NOT EXISTS contact_memory_sessions(session_id TEXT PRIMARY KEY,owner TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE);`)
  }
  migrateLegacy() {
    const rows = this.db.prepare('SELECT * FROM memories WHERE id NOT IN (SELECT id FROM contact_memory_records)').all() as { id: string; character_id: string; content: string; run_id: string | null; created_at: number }[]
    for (const r of rows) {
      // Existing user-visible legacy memories stay active; do not invent a task scope or missing evidence.
      const value: ContactMemory = { id: r.id, owner: r.character_id, revision: 1, content: r.content, kind: r.run_id ? 'research' : 'preference', scope: { kind: 'contact' }, source: r.run_id ? { kind: 'research', runId: r.run_id } : { kind: 'user', at: r.created_at }, createdAt: r.created_at, updatedAt: r.created_at, status: 'active' }
      this.save(value)
    }
  }
  registerSessions(owner: string, sessions: string[]) {
    if (!validId(owner) || !Array.isArray(sessions) || sessions.some(s => !validId(s))) throw new Error('会话归属无效。')
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM contact_memory_sessions WHERE owner=?').run(owner)
      for (const id of sessions) this.db.prepare('INSERT INTO contact_memory_sessions VALUES(?,?)').run(id, owner)
    })()
  }
  private validateScope(owner: string, input: MemoryInput) {
    const scope = input.scope, source = input.source
    if (!this.db.prepare('SELECT 1 FROM profiles WHERE character_id=?').get(owner)) throw new Error('联系人不存在。')
    if (scope.kind === 'task' && !this.db.prepare('SELECT 1 FROM topics WHERE id=? AND character_id=?').get(scope.topicId, owner)) throw new Error('记忆任务不属于此联系人。')
    if (scope.kind === 'session' && !this.db.prepare('SELECT 1 FROM contact_memory_sessions WHERE session_id=? AND owner=?').get(scope.sessionId, owner)) throw new Error('记忆会话不属于此联系人。')
    if (source.kind === 'research' && !this.db.prepare('SELECT 1 FROM runs WHERE id=? AND character_id=?').get(source.runId, owner)) throw new Error('研究来源不存在或不属于此联系人。')
    if (source.kind === 'conversation' && !this.db.prepare('SELECT 1 FROM contact_memory_sessions WHERE session_id=? AND owner=?').get(source.sessionId, owner)) throw new Error('对话来源不属于此联系人。')
    if (source.kind === 'delivery') {
      const row = this.db.prepare('SELECT d.value FROM delivery_versions d JOIN topics t ON t.id=d.topic_id WHERE d.topic_id=? AND d.version=? AND t.character_id=?').get(source.ref.topicId, source.ref.version, owner) as { value: string } | undefined
      if (source.ref.characterId !== owner || !row || (source.ref.sectionId && !readStoredDelivery(this.db, row.value).sections.some(s => s.id === source.ref.sectionId))) throw new Error('成果来源不存在或不属于此联系人。')
    }
  }
  list(owner: string): ContactMemory[] {
    return (this.db.prepare('SELECT value FROM contact_memory_records WHERE owner=? ORDER BY rowid DESC').all(owner) as { value: string }[]).map(r => JSON.parse(r.value) as ContactMemory).filter(m => m.status !== 'forgotten').sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
  }
  get(owner: string, id: string): ContactMemory {
    const row = this.db.prepare('SELECT value FROM contact_memory_records WHERE id=? AND owner=?').get(id, owner) as { value: string } | undefined
    if (!row) throw new Error('找不到此联系人的记忆。')
    return JSON.parse(row.value)
  }
  private check(owner: string, id: string, revision: number) {
    const m = this.get(owner, id)
    if (!Number.isSafeInteger(revision) || m.revision !== revision || m.status === 'forgotten') throw new Error('记忆已变化或被忘记，请重新读取。')
    return m
  }
  create(owner: string, raw: MemoryInput): ContactMemory {
    const input = validateMemoryInput(raw)
    return this.db.transaction(() => {
      this.validateScope(owner, input)
      const existing = this.list(owner), duplicate = existing.find(m => m.content === input.content && m.kind === input.kind && JSON.stringify(m.scope) === JSON.stringify(input.scope))
      if (duplicate) return duplicate
      if (existing.length >= 100) throw new Error('独立记忆已达 100 条（包含待确认），请先整理。')
      const value: ContactMemory = { ...input, id: randomUUID(), owner, revision: 1, status: input.source.kind === 'user' ? 'active' : 'candidate', createdAt: Date.now(), updatedAt: Date.now() }
      this.db.prepare('INSERT INTO memories(id,character_id,content,run_id,created_at) VALUES(?,?,?,?,?)').run(value.id, owner, value.content, value.source.kind === 'research' ? value.source.runId : null, value.createdAt)
      this.save(value); return value
    })()
  }
  update(owner: string, id: string, revision: number, raw: MemoryInput): ContactMemory {
    const input = validateMemoryInput(raw)
    return this.db.transaction(() => {
      const before = this.check(owner, id, revision)
      this.validateScope(owner, input)
      // Research never overwrites human corrections, even when the model supplies an existing ID.
      if (input.source.kind !== 'user') return this.create(owner, input)
      const after: ContactMemory = { ...before, ...input, revision: revision + 1, updatedAt: Date.now(), status: 'active' }
      this.db.prepare('UPDATE memories SET content=?,run_id=NULL WHERE id=? AND character_id=?').run(after.content, id, owner)
      this.save(after); return after
    })()
  }
  history(owner: string, id: string): ContactMemory[] {
    const current = this.get(owner, id)
    return (this.db.prepare('SELECT value FROM contact_memory_versions WHERE id=? ORDER BY revision DESC').all(id) as { value: string }[]).map(r => {
      const value = JSON.parse(r.value) as ContactMemory
      return current.status === 'forgotten' ? { ...value, content: '', status: 'forgotten' as const } : value
    })
  }
  forget(owner: string, id: string, revision: number) {
    this.db.transaction(() => {
      const before = this.check(owner, id, revision), after: ContactMemory = { ...before, revision: revision + 1, content: '', status: 'forgotten', updatedAt: Date.now() }
      this.db.prepare('DELETE FROM memories WHERE id=? AND character_id=?').run(id, owner)
      this.db.prepare("UPDATE contact_memory_versions SET value=json_set(value,'$.content','','$.status','forgotten') WHERE id=?").run(id)
      this.save(after)
    })()
  }
  select(context: ContactReadContext): { items: ContactMemory[]; truncated: boolean } {
    if (!context || !validId(context.characterId) || typeof context.query !== 'string' || context.query.length > 200000 || (context.topicId !== undefined && !validId(context.topicId)) || (context.sessionId !== undefined && !validId(context.sessionId))) throw new Error('记忆检索范围无效。')
    const terms = [...new Set(context.query.toLowerCase().match(/[a-z0-9]+|[\p{Script=Han}]{1,4}/gu) ?? [])]
    const score = (m: ContactMemory) => terms.reduce((n, term) => n + (m.content.toLowerCase().includes(term) ? term.length : 0), 0)
    const candidates = this.list(context.characterId).filter(m => m.status === 'active' && (m.scope.kind === 'contact' || (m.scope.kind === 'task' && m.scope.topicId === context.topicId) || (m.scope.kind === 'session' && m.scope.sessionId === context.sessionId)))
      .sort((a, b) => score(b) - score(a) || Number(b.revision > 1 && b.source.kind === 'user') - Number(a.revision > 1 && a.source.kind === 'user') || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
    const items: ContactMemory[] = []; let characters = 0
    for (const m of candidates) { if (items.length >= 12 || characters + m.content.length > 16000) break; items.push(m); characters += m.content.length }
    return { items, truncated: items.length < candidates.length }
  }
  private save(value: ContactMemory) {
    this.db.prepare('INSERT INTO contact_memory_records VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(value.id, value.owner, JSON.stringify(value))
    this.db.prepare('INSERT INTO contact_memory_versions VALUES(?,?,?)').run(value.id, value.revision, JSON.stringify(value))
  }
}
