import { afterEach, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentDeliveries } from './delivery'
import { ContactTaskStore } from '../task-center/contact-store'
import { deliveryMarkdown, type AgentDelivery } from '../../shared/agent-delivery'
import { deliveryHtmlExport } from '../../shared/delivery-presentation'

const databases: Database.Database[] = []
afterEach(() => databases.splice(0).forEach(db => db.close()))
function legacy(count: number) {
  const db = new Database(':memory:'); databases.push(db); db.pragma('foreign_keys=ON')
  db.exec(`CREATE TABLE topics(id TEXT PRIMARY KEY,character_id TEXT,value TEXT); CREATE TABLE runs(id TEXT PRIMARY KEY);
    CREATE TABLE delivery_versions(topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,version INTEGER,run_id TEXT UNIQUE REFERENCES runs(id),value TEXT,PRIMARY KEY(topic_id,version));`)
  db.prepare('INSERT INTO topics VALUES(?,?,?)').run('book', 'alice', JSON.stringify({ title: 'Book' }))
  const versions: AgentDelivery[] = []
  db.transaction(() => {
    for (let version = 1; version <= count; version++) {
      const runId = `run-${version}`
      const artifact: AgentDelivery = { version, runId, createdAt: version, completionCriteria: 'All chapters', summary: 'Saved', stages: [{ id: 'write', title: 'Write', status: 'active' }],
        sections: [...(versions.at(-1)?.sections ?? []), { id: `chapter-${version}`, title: `Chapter ${version}`, body: `${version}:正文😀\n第二段 <>& 与格式`.padEnd(80, 'x'), runId, sources: [{ url: 'https://example.com/', title: 'Source', capturedAt: version }] }],
        inputs: [{ id: 'genre', label: 'Genre', value: 'Fiction', required: true }], presentation: { title: 'Book', html: '<main id="content"/>', css: 'p{line-height:2}', script: '' }, fileIds: ['existing-file'] }
      versions.push(artifact); db.prepare('INSERT INTO runs VALUES(?)').run(runId)
      db.prepare('INSERT INTO delivery_versions VALUES(?,?,?,?)').run('book', version, runId, JSON.stringify(artifact))
    }
  })()
  return { db, versions }
}
it('reconstructs all 300 legacy versions and exports byte-for-byte after an idempotent migration', () => {
  const { db, versions } = legacy(300), deliveries = new AgentDeliveries(db)
  expect(db.prepare('SELECT count(*) AS n FROM delivery_blocks').get()).toEqual({ n: 300 })
  for (const old of versions) {
    const current = deliveries.get('book', old.version)!
    expect(current).toEqual(old)
    expect(deliveryMarkdown('Book', current)).toBe(deliveryMarkdown('Book', old))
    expect(deliveryHtmlExport('Book', current, 'alice')).toBe(deliveryHtmlExport('Book', old, 'alice'))
  }
  expect(new AgentDeliveries(db).get('book', 1)).toEqual(versions[0])
}, 60000)
it('rolls back all legacy replacements and newly written blocks if migration fails midway', () => {
  const { db, versions } = legacy(3)
  db.exec("CREATE TRIGGER reject_second BEFORE UPDATE ON delivery_versions WHEN new.version=2 BEGIN SELECT RAISE(ABORT,'migration fixture failure'); END")
  expect(() => new AgentDeliveries(db)).toThrow('migration fixture failure')
  expect((db.prepare('SELECT value FROM delivery_versions ORDER BY version').all() as { value: string }[]).map(r => JSON.parse(r.value))).toEqual(versions)
  expect(db.prepare('SELECT * FROM delivery_blocks').all()).toEqual([])
  db.exec('DROP TRIGGER reject_second')
  expect(new AgentDeliveries(db).get('book', 3)).toEqual(versions[2])
})
it('commits the incompatible format guard with schema migration, never before or after a partial upgrade', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-body-migration-')), file = join(dir, 'agents.db')
  try {
    const initial = new ContactTaskStore(file)
    initial.ensure('alice')
    const topic = initial.topics.create('alice', { title: 'Book', goal: 'Write', constraints: '' })
    const runId = initial.createRun('alice', '', Date.now(), topic.id)
    initial.finish(runId, { runId, title: 'First', body: 'Original', nextStep: 'Continue', evidence: [], createdAt: 1 }, [],
      { status: 'researching', judgement: 'Saved', reason: 'Continue', openQuestions: '', nextStep: 'Continue' })
    const original = initial.deliveries.get(topic.id)!
    initial.db.prepare('UPDATE delivery_versions SET value=? WHERE topic_id=?').run(JSON.stringify(original), topic.id)
    initial.db.exec('DELETE FROM delivery_block_references; DELETE FROM delivery_blocks')
    initial.db.pragma('user_version=17'); initial.close()
    const raw = new Database(file)
    raw.exec("CREATE TRIGGER schema_failure BEFORE INSERT ON portfolio_meta BEGIN SELECT RAISE(ABORT,'schema interrupted'); END")
    raw.close()
    expect(() => new ContactTaskStore(file)).toThrow('schema interrupted')
    const check = new Database(file)
    expect(check.pragma('user_version', { simple: true })).toBe(17)
    expect(JSON.parse((check.prepare('SELECT value FROM delivery_versions').get() as { value: string }).value)).toEqual(original)
    expect(check.prepare('SELECT * FROM delivery_blocks').all()).toEqual([])
    check.exec('DROP TRIGGER schema_failure'); check.close()
    const resumed = new ContactTaskStore(file)
    try { expect(resumed.db.pragma('user_version', { simple: true })).toBe(20) } finally { resumed.close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
