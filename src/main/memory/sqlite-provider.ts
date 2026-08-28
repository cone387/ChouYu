import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import fs from 'fs'
import type {
  MemoryCandidateInput,
  MemoryArchiveReason,
  MemoryCleanupSuggestion,
  MemoryConflict,
  MemoryConflictAction,
  MemoryConflictKind,
  MemoryFeedbackResult,
  MemoryFeedbackValue,
  MemoryListOptions,
  MemoryRecord,
  MemoryRevision,
  MemorySearchResult,
  MemoryStats,
  MemoryType
} from '../../shared/memory'
import {
  extractMemoryKeywords,
  getMemoryCleanupReasons,
  normalizeMemoryKey,
  scoreMemoryLifecycle,
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
  helpful_count: number
  unhelpful_count: number
  archived_reason: string | null
}

interface MemoryConflictRow {
  id: string
  candidate_id: string
  existing_memory_id: string
  existing_content: string
  kind: string
  reason: string
  status: string
  resolution: string | null
  created_at: number
  resolved_at: number | null
}

interface MemoryRevisionRow {
  id: string
  memory_id: string
  content: string
  type: string
  importance: number
  reason: string
  created_at: number
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
        expires_at INTEGER,
        helpful_count INTEGER NOT NULL DEFAULT 0,
        unhelpful_count INTEGER NOT NULL DEFAULT 0,
        archived_reason TEXT
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
      CREATE TABLE IF NOT EXISTS memory_conflicts (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        existing_memory_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        resolution TEXT,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER,
        UNIQUE(candidate_id, existing_memory_id),
        FOREIGN KEY (candidate_id) REFERENCES memories(id) ON DELETE CASCADE,
        FOREIGN KEY (existing_memory_id) REFERENCES memories(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_memory_conflicts_candidate ON memory_conflicts(candidate_id, status);
      CREATE TABLE IF NOT EXISTS memory_revisions (
        id TEXT PRIMARY KEY,
        memory_id TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT NOT NULL,
        importance REAL NOT NULL,
        reason TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_memory_revisions_memory ON memory_revisions(memory_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS memory_feedback (
        memory_id TEXT NOT NULL,
        context_id TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (memory_id, context_id),
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_memory_feedback_context ON memory_feedback(context_id);
    `)
    const memoryColumns = new Set((this.database.pragma('table_info(memories)') as Array<{ name: string }>).map((column) => column.name))
    if (!memoryColumns.has('helpful_count')) this.database.exec('ALTER TABLE memories ADD COLUMN helpful_count INTEGER NOT NULL DEFAULT 0')
    if (!memoryColumns.has('unhelpful_count')) this.database.exec('ALTER TABLE memories ADD COLUMN unhelpful_count INTEGER NOT NULL DEFAULT 0')
    if (!memoryColumns.has('archived_reason')) this.database.exec('ALTER TABLE memories ADD COLUMN archived_reason TEXT')
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
      expiresAt: row.expires_at || undefined,
      helpfulCount: row.helpful_count || 0,
      unhelpfulCount: row.unhelpful_count || 0,
      archivedReason: row.archived_reason as MemoryArchiveReason | undefined
    }
  }

  list(options: MemoryListOptions = {}): MemoryRecord[] {
    const rows = this.db().prepare('SELECT * FROM memories ORDER BY updated_at DESC LIMIT ?').all(Math.min(2000, Math.max(1, options.limit || 500))) as MemoryRow[]
    const normalizedQuery = options.query?.trim().toLowerCase() || ''
    const conflicts = this.listConflicts()
    const conflictsByCandidate = new Map<string, MemoryConflict[]>()
    conflicts.forEach((conflict) => conflictsByCandidate.set(conflict.candidateId, [...(conflictsByCandidate.get(conflict.candidateId) || []), conflict]))
    return rows.map((row) => ({ ...this.mapRow(row), conflicts: conflictsByCandidate.get(row.id) })).filter((memory) => {
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
      accessCount: 0,
      expiresAt: candidate.expiresAt,
      helpfulCount: 0,
      unhelpfulCount: 0
    }
    this.db().prepare(`
      INSERT INTO memories (
        id, type, content, normalized_key, keywords, importance, confidence, sensitivity, status,
        source_session_id, source_message_id, created_at, updated_at, access_count, expires_at, helpful_count, unhelpful_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 0)
    `).run(
      record.id, record.type, record.content, record.normalizedKey, JSON.stringify(record.keywords),
      record.importance, record.confidence, record.sensitivity, record.status,
      record.sourceSessionId || null, record.sourceMessageId || null, now, now, record.expiresAt || null
    )
    return record
  }

  approve(id: string): MemoryRecord {
    const unresolved = this.db().prepare("SELECT COUNT(*) AS count FROM memory_conflicts WHERE candidate_id = ? AND status = 'pending'").get(id) as { count: number }
    if (unresolved.count > 0) throw new Error('该候选与已有记忆冲突，请先选择替换、并存或拒绝。')
    const now = Date.now()
    const result = this.db().prepare("UPDATE memories SET status = 'active', updated_at = ? WHERE id = ? AND status = 'pending'").run(now, id)
    if (!result.changes) throw new Error('记忆候选不存在或已处理。')
    return this.getRequired(id)
  }

  reject(id: string): void {
    this.db().prepare("DELETE FROM memories WHERE id = ? AND status = 'pending'").run(id)
  }

  archive(id: string, reason: MemoryArchiveReason = 'manual'): void {
    const result = this.db().prepare("UPDATE memories SET status = 'archived', archived_reason = ?, updated_at = ? WHERE id = ? AND status = 'active'").run(reason, Date.now(), id)
    if (result.changes) {
      this.db().prepare('DELETE FROM memory_embeddings WHERE memory_id = ?').run(id)
      if (reason !== 'replace') this.db().prepare("DELETE FROM memory_conflicts WHERE existing_memory_id = ? AND status = 'pending'").run(id)
    }
  }

  archiveMany(ids: string[], reason: MemoryArchiveReason): string[] {
    const uniqueIds = [...new Set(ids)].slice(0, 500)
    return this.db().transaction(() => {
      const archived: string[] = []
      uniqueIds.forEach((id) => {
        const result = this.db().prepare("UPDATE memories SET status = 'archived', archived_reason = ?, updated_at = ? WHERE id = ? AND status = 'active'").run(reason, Date.now(), id)
        if (result.changes) {
          this.db().prepare('DELETE FROM memory_embeddings WHERE memory_id = ?').run(id)
          if (reason !== 'replace') this.db().prepare("DELETE FROM memory_conflicts WHERE existing_memory_id = ? AND status = 'pending'").run(id)
          archived.push(id)
        }
      })
      return archived
    })()
  }

  reactivate(id: string): MemoryRecord {
    const result = this.db().prepare("UPDATE memories SET status = 'active', archived_reason = NULL, expires_at = NULL, updated_at = ? WHERE id = ? AND status = 'archived'").run(Date.now(), id)
    if (!result.changes) throw new Error('归档记忆不存在或已经恢复。')
    return this.getRequired(id)
  }

  expireDue(now = Date.now()): string[] {
    const rows = this.db().prepare("SELECT id FROM memories WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?").all(now) as Array<{ id: string }>
    return this.archiveMany(rows.map((row) => row.id), 'expired')
  }

  enforceCapacity(maxItems: number): string[] {
    const limit = Math.min(2000, Math.max(50, Math.round(maxItems)))
    const rows = this.db().prepare("SELECT * FROM memories WHERE status = 'active'").all() as MemoryRow[]
    if (rows.length <= limit) return []
    const overflow = rows.length - limit
    const candidates = rows.map((row) => this.mapRow(row))
      .sort((left, right) => scoreMemoryLifecycle(left) - scoreMemoryLifecycle(right))
      .slice(0, overflow)
    return this.archiveMany(candidates.map((memory) => memory.id), 'capacity')
  }

  cleanupCandidates(limit = 30): MemoryCleanupSuggestion[] {
    const now = Date.now()
    const rows = this.db().prepare("SELECT * FROM memories WHERE status = 'active'").all() as MemoryRow[]
    return rows.map((row) => this.mapRow(row)).map((memory) => ({
      ...memory,
      cleanupScore: scoreMemoryLifecycle(memory, now),
      reasons: getMemoryCleanupReasons(memory, now)
    })).filter((memory) => memory.reasons.length > 0)
      .sort((left, right) => left.cleanupScore - right.cleanupScore)
      .slice(0, Math.min(100, Math.max(1, limit)))
  }

  recordFeedback(memoryId: string, contextId: string, value: MemoryFeedbackValue): MemoryFeedbackResult {
    return this.db().transaction(() => {
      const memory = this.getRequired(memoryId)
      const previous = this.db().prepare('SELECT value FROM memory_feedback WHERE memory_id = ? AND context_id = ?').get(memoryId, contextId) as { value: MemoryFeedbackValue } | undefined
      if (previous?.value !== value) {
        if (previous?.value === 'helpful') this.db().prepare('UPDATE memories SET helpful_count = MAX(0, helpful_count - 1) WHERE id = ?').run(memoryId)
        if (previous?.value === 'unhelpful') this.db().prepare('UPDATE memories SET unhelpful_count = MAX(0, unhelpful_count - 1) WHERE id = ?').run(memoryId)
        this.db().prepare(`
          INSERT INTO memory_feedback (memory_id, context_id, value, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(memory_id, context_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(memoryId, contextId, value, Date.now())
        this.db().prepare(value === 'helpful'
          ? 'UPDATE memories SET helpful_count = helpful_count + 1 WHERE id = ?'
          : 'UPDATE memories SET unhelpful_count = unhelpful_count + 1 WHERE id = ?').run(memoryId)
      }
      const updated = previous?.value === value ? memory : this.getRequired(memoryId)
      return {
        memoryId,
        contextId,
        value,
        helpfulCount: updated.helpfulCount,
        unhelpfulCount: updated.unhelpfulCount
      }
    })()
  }

  update(id: string, patch: MemoryUpdate): MemoryRecord {
    const current = this.getRequired(id)
    const content = (patch.content ?? current.content).trim().slice(0, 500)
    if (!content) throw new Error('记忆内容不能为空。')
    const type = (patch.type ?? current.type) as MemoryType
    const importance = patch.importance === undefined ? current.importance : Math.min(1, Math.max(0, patch.importance))
    const expiresAt = patch.expiresAt === undefined ? current.expiresAt : patch.expiresAt || undefined
    if (current.status === 'active' && (content !== current.content || type !== current.type || importance !== current.importance)) {
      this.insertRevision(current, 'edit')
    }
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
      embeddings: Number((this.db().prepare('SELECT COUNT(*) AS count FROM memory_embeddings').get() as { count: number }).count || 0),
      expiringSoon: Number((this.db().prepare("SELECT COUNT(*) AS count FROM memories WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at > ? AND expires_at <= ?").get(Date.now(), Date.now() + 7 * 86_400_000) as { count: number }).count || 0)
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

  createConflict(candidateId: string, existingMemoryId: string, kind: MemoryConflictKind, reason: string): MemoryConflict {
    const candidate = this.getRequired(candidateId)
    const existing = this.getRequired(existingMemoryId)
    if (candidate.status !== 'pending' || existing.status !== 'active') throw new Error('冲突记忆状态无效。')
    const id = randomUUID()
    const now = Date.now()
    this.db().prepare(`
      INSERT OR IGNORE INTO memory_conflicts (
        id, candidate_id, existing_memory_id, kind, reason, status, created_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `).run(id, candidateId, existingMemoryId, kind, reason.slice(0, 500), now)
    const conflict = this.listConflicts(candidateId).find((item) => item.existingMemoryId === existingMemoryId)
    if (!conflict) throw new Error('创建记忆冲突失败。')
    return conflict
  }

  listConflicts(candidateId?: string): MemoryConflict[] {
    const where = candidateId ? 'WHERE c.candidate_id = ?' : ''
    const statement = this.db().prepare(`
      SELECT c.*, m.content AS existing_content
      FROM memory_conflicts c
      JOIN memories m ON m.id = c.existing_memory_id
      ${where}
      ORDER BY c.created_at ASC
    `)
    const rows = (candidateId ? statement.all(candidateId) : statement.all()) as MemoryConflictRow[]
    return rows.map((row) => ({
      id: row.id,
      candidateId: row.candidate_id,
      existingMemoryId: row.existing_memory_id,
      existingContent: row.existing_content,
      kind: row.kind as MemoryConflictKind,
      reason: row.reason,
      status: row.status as MemoryConflict['status'],
      resolution: row.resolution as MemoryConflictAction | undefined,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at || undefined
    }))
  }

  resolveConflict(candidateId: string, action: MemoryConflictAction): MemoryRecord | null {
    return this.db().transaction(() => {
      const candidate = this.getRequired(candidateId)
      if (candidate.status !== 'pending') throw new Error('记忆候选不存在或已处理。')
      const conflicts = this.listConflicts(candidateId).filter((conflict) => conflict.status === 'pending')
      if (conflicts.length === 0) throw new Error('该候选没有待处理冲突。')
      if (action === 'reject') {
        this.reject(candidateId)
        return null
      }
      if (action === 'replace') {
        const archived = new Set<string>()
        conflicts.forEach((conflict) => {
          if (archived.has(conflict.existingMemoryId)) return
          const existing = this.getRequired(conflict.existingMemoryId)
          if (existing.status === 'active') {
            this.insertRevision(existing, 'replace')
            this.archive(existing.id, 'replace')
          }
          archived.add(existing.id)
        })
      }
      const now = Date.now()
      this.db().prepare("UPDATE memories SET status = 'active', updated_at = ? WHERE id = ? AND status = 'pending'").run(now, candidateId)
      this.db().prepare(`
        UPDATE memory_conflicts SET status = 'resolved', resolution = ?, resolved_at = ?
        WHERE candidate_id = ? AND status = 'pending'
      `).run(action, now, candidateId)
      return this.getRequired(candidateId)
    })()
  }

  listRevisions(memoryId: string): MemoryRevision[] {
    this.getRequired(memoryId)
    const rows = this.db().prepare('SELECT * FROM memory_revisions WHERE memory_id = ? ORDER BY created_at DESC').all(memoryId) as MemoryRevisionRow[]
    return rows.map((row) => ({
      id: row.id,
      memoryId: row.memory_id,
      content: row.content,
      type: row.type as MemoryType,
      importance: row.importance,
      reason: row.reason as MemoryRevision['reason'],
      createdAt: row.created_at
    }))
  }

  restoreRevision(memoryId: string, revisionId: string): MemoryRecord {
    return this.db().transaction(() => {
      const current = this.getRequired(memoryId)
      if (current.status !== 'active') throw new Error('只能恢复已启用记忆的历史版本。')
      const revision = this.db().prepare('SELECT * FROM memory_revisions WHERE id = ? AND memory_id = ?').get(revisionId, memoryId) as MemoryRevisionRow | undefined
      if (!revision) throw new Error('记忆版本不存在。')
      this.insertRevision(current, 'restore')
      this.db().prepare(`
        UPDATE memories SET type = ?, content = ?, normalized_key = ?, keywords = ?, importance = ?, updated_at = ? WHERE id = ?
      `).run(
        revision.type,
        revision.content,
        normalizeMemoryKey(revision.content),
        JSON.stringify(extractMemoryKeywords(revision.content)),
        revision.importance,
        Date.now(),
        memoryId
      )
      return this.getRequired(memoryId)
    })()
  }

  private insertRevision(memory: MemoryRecord, reason: MemoryRevision['reason']): void {
    this.db().prepare(`
      INSERT INTO memory_revisions (id, memory_id, content, type, importance, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), memory.id, memory.content, memory.type, memory.importance, reason, Date.now())
  }

  private getRequired(id: string): MemoryRecord {
    const row = this.db().prepare('SELECT * FROM memories WHERE id = ? LIMIT 1').get(id) as MemoryRow | undefined
    if (!row) throw new Error('记忆不存在或已删除。')
    return this.mapRow(row)
  }
}
