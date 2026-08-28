import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import fs from 'fs'
import type {
  MemoryCandidateInput,
  MemoryListOptions,
  MemoryRecord,
  MemorySearchResult,
  MemoryStats,
  MemoryType
} from '../../shared/memory'
import {
  extractMemoryKeywords,
  normalizeMemoryKey,
  scoreMemory
} from '../../shared/memory'
import type { MemoryEmbeddingRecord, MemoryProvider, MemoryUpdate } from './provider'

interface MemoryRow {
  id: string
  type: string
  content: string
  normalized_key: string
  keywords: string
  importance: number
  confidence: number
  sensitivity: string
  status: string
  source_session_id: string | null
  source_message_id: string | null
  created_at: number
  updated_at: number
  last_accessed_at: number | null
  access_count: number
  expires_at: number | null
}

export class SQLiteMemoryProvider implements MemoryProvider {
  private database: Database.Database | null = null

  constructor(private readonly filePath: string) {}

  initialize(): void {
    if (this.database) return
    this.database = new Database(this.filePath)
    this.database.pragma('journal_mode = WAL')
    this.database.pragma('synchronous = NORMAL')
    this.database.pragma('foreign_keys = ON')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        normalized_key TEXT NOT NULL,
        keywords TEXT NOT NULL,
        importance REAL NOT NULL DEFAULT 0.5,
        confidence REAL NOT NULL DEFAULT 0.5,
        sensitivity TEXT NOT NULL DEFAULT 'normal',
        status TEXT NOT NULL DEFAULT 'pending',
        source_session_id TEXT,
        source_message_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_accessed_at INTEGER,
        access_count INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_memories_status_updated ON memories(status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_memories_normalized_key ON memories(normalized_key);
      CREATE INDEX IF NOT EXISTS idx_memories_source_session ON memories(source_session_id);
      CREATE TABLE IF NOT EXISTS memory_embeddings (
        memory_id TEXT NOT NULL,
        model TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector BLOB NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (memory_id, model),
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_memory_embeddings_model ON memory_embeddings(model);
    `)
  }

  close(): void {
    this.database?.close()
    this.database = null
  }

  private db(): Database.Database {
    if (!this.database) throw new Error('Memory provider is not initialized')
    return this.database
  }

  private mapRow(row: MemoryRow): MemoryRecord {
    return {
      id: row.id,
      type: row.type as MemoryRecord['type'],
      content: row.content,
      normalizedKey: row.normalized_key,
      keywords: JSON.parse(row.keywords || '[]'),
      importance: row.importance,
      confidence: row.confidence,
      sensitivity: row.sensitivity as MemoryRecord['sensitivity'],
      status: row.status as MemoryRecord['status'],
      sourceSessionId: row.source_session_id || undefined,
      sourceMessageId: row.source_message_id || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastAccessedAt: row.last_accessed_at || undefined,
      accessCount: row.access_count,
      expiresAt: row.expires_at || undefined
    }
  }

  list(options: MemoryListOptions = {}): MemoryRecord[] {
    const rows = this.db().prepare('SELECT * FROM memories ORDER BY updated_at DESC LIMIT ?').all(Math.min(2000, Math.max(1, options.limit || 500))) as MemoryRow[]
    const normalizedQuery = options.query?.trim().toLowerCase() || ''
    return rows.map((row) => this.mapRow(row)).filter((memory) => {
      if (options.status && options.status !== 'all' && memory.status !== options.status) return false
      if (options.type && options.type !== 'all' && memory.type !== options.type) return false
      if (normalizedQuery && !memory.content.toLowerCase().includes(normalizedQuery) && !memory.keywords.some((keyword) => keyword.includes(normalizedQuery))) return false
      return true
    })
  }

  createCandidate(candidate: MemoryCandidateInput): MemoryRecord | null {
    const normalizedKey = normalizeMemoryKey(candidate.content)
    if (!normalizedKey) return null
    const existing = this.db().prepare("SELECT * FROM memories WHERE normalized_key = ? AND status IN ('pending', 'active') LIMIT 1").get(normalizedKey) as MemoryRow | undefined
    if (existing) return null
    return this.insert(candidate, 'pending')
  }

  createActive(candidate: MemoryCandidateInput): MemoryRecord {
    const normalizedKey = normalizeMemoryKey(candidate.content)
    const existing = this.db().prepare("SELECT * FROM memories WHERE normalized_key = ? AND status = 'active' LIMIT 1").get(normalizedKey) as MemoryRow | undefined
    if (existing) return this.mapRow(existing)
    return this.insert(candidate, 'active')
  }

  private insert(candidate: MemoryCandidateInput, status: 'pending' | 'active'): MemoryRecord {
    const now = Date.now()
    const record: MemoryRecord = {
      id: randomUUID(),
      type: candidate.type,
      content: candidate.content.trim().slice(0, 500),
      normalizedKey: normalizeMemoryKey(candidate.content),
      keywords: extractMemoryKeywords(candidate.content),
      importance: Math.min(1, Math.max(0, candidate.importance)),
      confidence: Math.min(1, Math.max(0, candidate.confidence)),
      sensitivity: candidate.sensitivity,
      status,
      sourceSessionId: candidate.sourceSessionId,
      sourceMessageId: candidate.sourceMessageId,
      createdAt: now,
      updatedAt: now,
      accessCount: 0
    }
    this.db().prepare(`
      INSERT INTO memories (
        id, type, content, normalized_key, keywords, importance, confidence, sensitivity, status,
        source_session_id, source_message_id, created_at, updated_at, access_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `).run(
      record.id, record.type, record.content, record.normalizedKey, JSON.stringify(record.keywords),
      record.importance, record.confidence, record.sensitivity, record.status,
      record.sourceSessionId || null, record.sourceMessageId || null, now, now
    )
    return record
  }

  approve(id: string): MemoryRecord {
    const now = Date.now()
    const result = this.db().prepare("UPDATE memories SET status = 'active', updated_at = ? WHERE id = ? AND status = 'pending'").run(now, id)
    if (!result.changes) throw new Error('记忆候选不存在或已处理。')
    return this.getRequired(id)
  }

  reject(id: string): void {
    this.db().prepare("DELETE FROM memories WHERE id = ? AND status = 'pending'").run(id)
  }

  update(id: string, patch: MemoryUpdate): MemoryRecord {
    const current = this.getRequired(id)
    const content = (patch.content ?? current.content).trim().slice(0, 500)
    if (!content) throw new Error('记忆内容不能为空。')
    const type = (patch.type ?? current.type) as MemoryType
    const importance = patch.importance === undefined ? current.importance : Math.min(1, Math.max(0, patch.importance))
    const expiresAt = patch.expiresAt === undefined ? current.expiresAt : patch.expiresAt || undefined
    this.db().prepare(`
      UPDATE memories SET type = ?, content = ?, normalized_key = ?, keywords = ?, importance = ?, expires_at = ?, updated_at = ? WHERE id = ?
    `).run(type, content, normalizeMemoryKey(content), JSON.stringify(extractMemoryKeywords(content)), importance, expiresAt || null, Date.now(), id)
    return this.getRequired(id)
  }

  delete(id: string): void {
    this.db().prepare('DELETE FROM memories WHERE id = ?').run(id)
  }

  clear(): void {
    this.db().prepare('DELETE FROM memories').run()
  }

  search(query: string, limit = 6): MemorySearchResult[] {
    const now = Date.now()
    const queryKeywords = extractMemoryKeywords(query)
    const normalizedQuery = normalizeMemoryKey(query)
    const rows = this.db().prepare("SELECT * FROM memories WHERE status = 'active' AND (expires_at IS NULL OR expires_at > ?) ORDER BY importance DESC, updated_at DESC LIMIT 1000").all(now) as MemoryRow[]
    const matches = rows.map((row) => this.mapRow(row)).map((memory) => {
      const lexical = normalizedQuery && memory.normalizedKey.includes(normalizedQuery)
      const keyword = queryKeywords.some((item) => memory.keywords.includes(item) || memory.content.toLowerCase().includes(item))
      const globalPreference = ['preference', 'workflow'].includes(memory.type) && memory.importance >= 0.7
      return { ...memory, score: scoreMemory(memory, query, now), matched: lexical || keyword || globalPreference }
    }).filter((memory) => memory.matched)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(12, Math.max(1, limit)))
      .map(({ matched: _matched, ...memory }) => memory)

    if (matches.length > 0) {
      const update = this.db().prepare('UPDATE memories SET last_accessed_at = ?, access_count = access_count + 1 WHERE id = ?')
      this.db().transaction((items: MemorySearchResult[]) => {
        for (const item of items) update.run(now, item.id)
      })(matches)
    }
    return matches
  }

  stats(): MemoryStats {
    const counts = this.db().prepare('SELECT status, COUNT(*) AS count FROM memories GROUP BY status').all() as Array<{ status: string; count: number }>
    const byStatus = Object.fromEntries(counts.map((item) => [item.status, item.count]))
    return {
      active: byStatus.active || 0,
      pending: byStatus.pending || 0,
      archived: byStatus.archived || 0,
      databaseSize: fs.existsSync(this.filePath) ? fs.statSync(this.filePath).size : 0,
      embeddings: Number((this.db().prepare('SELECT COUNT(*) AS count FROM memory_embeddings').get() as { count: number }).count || 0)
    }
  }

  exportAll(): MemoryRecord[] {
    return this.list({ status: 'all', limit: 2000 })
  }

  upsertEmbedding(memoryId: string, model: string, vector: number[]): void {
    if (!vector.length || vector.length > 8192 || vector.some((item) => !Number.isFinite(item))) throw new Error('Embedding 向量无效。')
    this.getRequired(memoryId)
    const floatVector = new Float32Array(vector)
    const buffer = Buffer.from(floatVector.buffer, floatVector.byteOffset, floatVector.byteLength)
    this.db().prepare(`
      INSERT INTO memory_embeddings (memory_id, model, dimensions, vector, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(memory_id, model) DO UPDATE SET dimensions = excluded.dimensions, vector = excluded.vector, updated_at = excluded.updated_at
    `).run(memoryId, model.slice(0, 256), vector.length, buffer, Date.now())
  }

  getEmbeddings(model: string): MemoryEmbeddingRecord[] {
    const rows = this.db().prepare(`
      SELECT m.*, e.dimensions AS embedding_dimensions, e.vector AS embedding_vector
      FROM memory_embeddings e JOIN memories m ON m.id = e.memory_id
      WHERE e.model = ? AND m.status = 'active' AND (m.expires_at IS NULL OR m.expires_at > ?)
    `).all(model, Date.now()) as Array<MemoryRow & { embedding_dimensions: number; embedding_vector: Buffer }>
    return rows.flatMap((row) => {
      const bytes = row.embedding_vector
      if (!Buffer.isBuffer(bytes) || bytes.byteLength !== row.embedding_dimensions * 4) return []
      const copy = Buffer.from(bytes)
      const arrayBuffer = copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength)
      const vector = Array.from(new Float32Array(arrayBuffer))
      return [{ memory: this.mapRow(row), vector }]
    })
  }

  clearEmbeddings(model?: string): void {
    if (model) this.db().prepare('DELETE FROM memory_embeddings WHERE model = ?').run(model)
    else this.db().prepare('DELETE FROM memory_embeddings').run()
  }

  private getRequired(id: string): MemoryRecord {
    const row = this.db().prepare('SELECT * FROM memories WHERE id = ? LIMIT 1').get(id) as MemoryRow | undefined
    if (!row) throw new Error('记忆不存在或已删除。')
    return this.mapRow(row)
  }
}
