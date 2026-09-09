import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { initializeSemanticCache, readSemanticCache, writeSemanticCache, clearSemanticCache, semanticHash, semanticSourceHash, type SemanticCacheEntry } from '../journal/semantic-cache'

export function runJournalSemanticCacheSmoke(): void {
  const file = join(app.getPath('userData'), 'semantic-cache-fixture.db')
  let db = new Database(file)
  const source = { id: 'capture:fixture', app: 'editor', title: '合成页面', text: '合成 OCR 正文' }, scope = semanticHash('connection-one')
  const entry: SemanticCacheEntry = { sourceId: source.id, sourceHash: semanticSourceHash(source), chunks: [{ key: semanticHash('chunk'), vector: [1, 0] }] }
  const request = { scope, sources: [entry] }
  const reject = (operation: () => unknown) => { let rejected = false; try { operation() } catch { rejected = true } if (!rejected) throw new Error('Invalid semantic cache write accepted') }
  try {
    db.exec('CREATE TABLE activities(id INTEGER PRIMARY KEY,app TEXT,title TEXT); CREATE TABLE captures(id TEXT PRIMARY KEY,app TEXT,title TEXT,ocrText TEXT)')
    initializeSemanticCache(db)
    db.prepare('INSERT INTO captures VALUES(?,?,?,?)').run('fixture', source.app, source.title, source.text)
    const first = readSemanticCache(db, request)
    writeSemanticCache(db, { scope, generation: first.generation, entries: [entry] })
    db.close(); db = new Database(file)
    if (readSemanticCache(db, request).entries.length !== 1) throw new Error('Semantic cache did not persist across SQLite reopen')
    if (readSemanticCache(db, { ...request, scope: semanticHash('another-account') }).entries.length) throw new Error('Semantic cache crossed connection scopes')
    if (JSON.stringify(db.prepare('SELECT * FROM journal_semantic_cache').all()).includes(source.text)) throw new Error('Semantic cache duplicated source plaintext')
    db.prepare("UPDATE captures SET ocrText='new OCR' WHERE id='fixture'").run()
    if (readSemanticCache(db, request).entries.length) throw new Error('OCR change retained stale vectors')
    reject(() => writeSemanticCache(db, { scope, generation: first.generation, entries: [entry] }))
    db.prepare('UPDATE captures SET ocrText=? WHERE id=?').run(source.text, 'fixture')
    writeSemanticCache(db, { scope, generation: first.generation, entries: [entry] })
    clearSemanticCache(db)
    reject(() => writeSemanticCache(db, { scope, generation: first.generation, entries: [entry] }))
    const fresh = readSemanticCache(db, request)
    writeSemanticCache(db, { scope, generation: fresh.generation, entries: [entry] })
    db.prepare("UPDATE journal_semantic_cache SET value='corrupt JSON'").run()
    if (readSemanticCache(db, request).entries.length) throw new Error('Corrupt semantic cache was reused')
    writeSemanticCache(db, { scope, generation: fresh.generation, entries: [entry] })
    db.prepare("DELETE FROM captures WHERE id='fixture'").run()
    if (readSemanticCache(db, request).entries.length) throw new Error('Deleting capture retained its vectors')
    db.transaction(() => {
      for (let id = 1; id <= 4097; id++) {
        db.prepare('INSERT INTO activities VALUES(?,?,?)').run(id, 'editor', 'fixture')
        const row = { ...entry, sourceId: `activity:${id}`, sourceHash: semanticSourceHash({ id: `activity:${id}`, app: 'editor', title: 'fixture', text: '' }) }
        db.prepare('INSERT INTO journal_semantic_cache VALUES(?,?,?,?,?)').run(scope, row.sourceId, row.sourceHash, JSON.stringify(row), id)
      }
    })()
    const last = { ...entry, sourceId: 'activity:4097', sourceHash: semanticSourceHash({ id: 'activity:4097', app: 'editor', title: 'fixture', text: '' }) }
    writeSemanticCache(db, { scope, generation: fresh.generation, entries: [last] })
    if ((db.prepare('SELECT COUNT(*) count FROM journal_semantic_cache').get() as { count: number }).count !== 4096 || db.prepare("SELECT 1 FROM journal_semantic_cache WHERE sourceId='activity:1'").get()) throw new Error('Semantic source limit failed to evict oldest record')
    db.prepare('DELETE FROM activities WHERE id=4097').run()
    if (readSemanticCache(db, { scope, sources: [last] }).entries.length) throw new Error('Deleting activity retained its vectors')
    console.log('CHOUYU_SEMANTIC_CACHE_SMOKE_PASSED persistence, scope isolation, OCR/deletion invalidation, clear generation, corrupt entry recovery and capacity eviction')
  } finally { db.close() }
}
