import type Database from 'better-sqlite3'
import { createHash } from 'crypto'
import type { JournalEvidence } from '../../shared/journal'

export const semanticHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const semanticSourceHash = (source: Pick<JournalEvidence, 'id' | 'app' | 'title' | 'text'>) => semanticHash([source.id, source.app, source.title, source.text])
export interface SemanticCacheEntry { sourceId: string; sourceHash: string; chunks: Array<{ key: string; vector: number[] }> }
export interface SemanticCache {
  read(scope: string, sources: Array<{ sourceId: string; sourceHash: string }>): Promise<{ generation: number; entries: SemanticCacheEntry[] }>
  write(scope: string, generation: number, entries: SemanticCacheEntry[]): Promise<void>
  clear(): Promise<void>
}
const validHash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
export function validSemanticCacheEntry(entry: SemanticCacheEntry): boolean {
  return Boolean(entry && typeof entry.sourceId === 'string' && validHash(entry.sourceHash) && Array.isArray(entry.chunks) && entry.chunks.length > 0 && entry.chunks.length <= 512 && entry.chunks.every(chunk => chunk && validHash(chunk.key) && Array.isArray(chunk.vector) && chunk.vector.length > 0 && chunk.vector.length <= 8192 && chunk.vector.every(value => typeof value === 'number' && Number.isFinite(value)) && chunk.vector.some(value => value !== 0)))
}
export function initializeSemanticCache(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS journal_semantic_cache (scope TEXT NOT NULL,sourceId TEXT NOT NULL,sourceHash TEXT NOT NULL,value TEXT NOT NULL,touched INTEGER NOT NULL,PRIMARY KEY(scope,sourceId));
    CREATE TABLE IF NOT EXISTS journal_semantic_cache_state (id INTEGER PRIMARY KEY CHECK(id=1),generation INTEGER NOT NULL);
    INSERT OR IGNORE INTO journal_semantic_cache_state VALUES(1,0);
    CREATE TRIGGER IF NOT EXISTS journal_semantic_activity_delete AFTER DELETE ON activities BEGIN DELETE FROM journal_semantic_cache WHERE sourceId='activity:'||old.id; END;
    CREATE TRIGGER IF NOT EXISTS journal_semantic_capture_delete AFTER DELETE ON captures BEGIN DELETE FROM journal_semantic_cache WHERE sourceId='capture:'||old.id; END;
    CREATE TRIGGER IF NOT EXISTS journal_semantic_activity_update AFTER UPDATE OF app,title ON activities BEGIN DELETE FROM journal_semantic_cache WHERE sourceId='activity:'||old.id; END;
    CREATE TRIGGER IF NOT EXISTS journal_semantic_capture_update AFTER UPDATE OF app,title,ocrText ON captures BEGIN DELETE FROM journal_semantic_cache WHERE sourceId='capture:'||old.id; END;`)
}
const generation = (db: Database.Database) => (db.prepare('SELECT generation FROM journal_semantic_cache_state WHERE id=1').get() as { generation: number }).generation
export function readSemanticCache(db: Database.Database, input: { scope: string; sources: Array<{ sourceId: string; sourceHash: string }> }) {
  if (!input || !validHash(input.scope) || !Array.isArray(input.sources) || input.sources.length > 600) throw new Error('无效语义索引请求。')
  return db.transaction(() => {
    const entries: SemanticCacheEntry[] = []
    for (const source of input.sources) {
      if (!source || typeof source.sourceId !== 'string' || !validHash(source.sourceHash)) throw new Error('无效语义来源。')
      const row = db.prepare('SELECT value FROM journal_semantic_cache WHERE scope=? AND sourceId=? AND sourceHash=?').get(input.scope, source.sourceId, source.sourceHash) as { value: string } | undefined
      if (!row) continue
      try {
        const entry = JSON.parse(row.value)
        if (!validSemanticCacheEntry(entry) || entry.sourceId !== source.sourceId || entry.sourceHash !== source.sourceHash) throw new Error('Invalid cache')
        entries.push(entry)
        db.prepare('UPDATE journal_semantic_cache SET touched=? WHERE scope=? AND sourceId=?').run(Date.now(), input.scope, source.sourceId)
      } catch { db.prepare('DELETE FROM journal_semantic_cache WHERE scope=? AND sourceId=?').run(input.scope, source.sourceId) }
    }
    return { generation: generation(db), entries }
  }).immediate()
}
export function writeSemanticCache(db: Database.Database, input: { scope: string; generation: number; entries: SemanticCacheEntry[] }): void {
  if (!input || !validHash(input.scope) || !Number.isSafeInteger(input.generation) || !Array.isArray(input.entries) || input.entries.length > 600 || input.entries.some(entry => !validSemanticCacheEntry(entry))) throw new Error('无效语义索引数据。')
  db.transaction(() => {
    if (generation(db) !== input.generation) throw new Error('语义索引已清空，旧检索不会重新写回。')
    for (const entry of input.entries) {
      const match = /^(activity|capture):(.+)$/.exec(entry.sourceId)
      if (!match) throw new Error('无效语义索引来源。')
      const source = match[1] === 'activity'
        ? db.prepare("SELECT 'activity:'||id id,app,title,'' text FROM activities WHERE id=?").get(match[2])
        : db.prepare("SELECT 'capture:'||id id,app,title,ocrText text FROM captures WHERE id=?").get(match[2])
      if (!source || semanticSourceHash(source as JournalEvidence) !== entry.sourceHash) throw new Error('语义索引来源已删除或改写。')
      const value = JSON.stringify(entry)
      if (Buffer.byteLength(value) > 8 * 1024 * 1024) throw new Error('单条语义来源索引超过 8 MiB，未保留本次索引。')
      db.prepare('INSERT INTO journal_semantic_cache VALUES(?,?,?,?,?) ON CONFLICT(scope,sourceId) DO UPDATE SET sourceHash=excluded.sourceHash,value=excluded.value,touched=excluded.touched').run(input.scope, entry.sourceId, entry.sourceHash, value, Date.now())
    }
    const rows = db.prepare('SELECT scope,sourceId,length(CAST(value AS BLOB)) bytes FROM journal_semantic_cache ORDER BY touched,scope,sourceId').all() as Array<{ scope: string; sourceId: string; bytes: number }>
    let bytes = rows.reduce((sum, row) => sum + row.bytes, 0), count = rows.length
    for (const row of rows) {
      if (bytes <= 64 * 1024 * 1024 && count <= 4096) break
      db.prepare('DELETE FROM journal_semantic_cache WHERE scope=? AND sourceId=?').run(row.scope, row.sourceId)
      bytes -= row.bytes; count--
    }
  }).immediate()
}
export function clearSemanticCache(db: Database.Database): void {
  db.transaction(() => { db.prepare('DELETE FROM journal_semantic_cache').run(); db.prepare('UPDATE journal_semantic_cache_state SET generation=generation+1 WHERE id=1').run() }).immediate()
}
