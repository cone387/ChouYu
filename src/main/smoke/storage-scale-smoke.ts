import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import Database from 'better-sqlite3'
import { AttachmentStore } from '../attachment-store'
import { initDatabase, getSession, getSessions, saveSessionMessages, flushDatabase, searchSessions, getState } from '../database'
import { DEFAULT_CHARACTER_ID } from '../../shared/characters'
import { ContactTaskStore } from '../task-center/contact-store'
import { deliveryMarkdown } from '../../shared/agent-delivery'
import { deliveryHtmlExport } from '../../shared/delivery-presentation'

async function sample<T>(operation: () => T) {
  const start = performance.now()
  const next = new Promise<number>(resolve => setImmediate(() => resolve(performance.now() - start)))
  const value = operation(), durationMs = performance.now() - start
  return { value, durationMs, eventLoopDelayMs: await next }
}
function bytes(directory: string): number {
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((n, f) => n + (f.isDirectory() ? bytes(path.join(directory, f.name)) : fs.statSync(path.join(directory, f.name)).size), 0)
}
export async function runStorageScaleSmoke() {
  // The runner creates this root itself; there is no product setting or user-data argument.
  const root = app.getPath('userData')
  assert.equal(process.env.CHOUYU_SMOKE_TEST, '1')
  assert.equal(path.dirname(root), os.tmpdir())
  assert.match(path.basename(root), /^chouyu-smoke-/)
  const report = { commit: process.env.CHOUYU_BENCHMARK_COMMIT, platform: process.platform, node: process.versions.node,
    electron: process.versions.electron, cpu: os.cpus()[0]?.model, createdAt: new Date().toISOString(),
    conversations: [] as unknown[], deliveries: [] as unknown[], errors: [] as string[] }
  for (const count of [1000, 10000, 50000]) {
    const dir = path.join(root, `messages-${count}`)
    fs.mkdirSync(dir)
    const attachment = new AttachmentStore(path.join(dir, 'attachments')).persist('data:image/png;base64,AQID')
    const sessions = Array.from({ length: count / 500 }, (_, s) => ({ id: `session-${s}`, title: `Conversation ${s}`,
      characterId: DEFAULT_CHARACTER_ID, createdAt: 1, updatedAt: 1000, lastReadAt: 100,
      messages: Array.from({ length: 500 }, (_, i) => ({ id: `m-${s}-${i}`, role: i % 2 ? 'assistant' : 'user',
        content: `needle-${s}-${i} ` + 'A saved message with source and reading state. '.repeat(12), timestamp: i + 1,
        ...(i === 0 ? { imageUrl: attachment } : {}),
        ...(i % 2 ? { replyCompletedAt: i + 1, replyReadAt: i < 100 ? i + 1 : undefined,
          communication: { version: 1, characterId: DEFAULT_CHARACTER_ID, intent: 'reply', source: { kind: 'conversation', sessionId: `session-${s}` } } } : {}) })) }))
    fs.writeFileSync(path.join(dir, 'chouyu-data.json'), JSON.stringify({ version: 4, config: {}, characters: [], sessions,
      activeSessionId: sessions[0].id, state: { 'benchmark:receipt': 'persisted' } }))
    app.setPath('userData', dir)
    const startup = await sample(initDatabase)
    assert.equal(getSessions().reduce((n, s) => n + s.messageCount, 0), count)
    assert.equal(getState('benchmark:receipt'), 'persisted')
    const search = await sample(() => searchSessions(`needle-${sessions.length - 1}-499`))
    assert.equal(search.value.length, 1)
    const updates = []
    const sql = fs.existsSync(path.join(dir, 'chouyu-application.db')) ? new Database(path.join(dir, 'chouyu-application.db')) : null
    sql?.exec(`CREATE TABLE benchmark_writes(id TEXT); CREATE TRIGGER benchmark_update AFTER UPDATE ON messages BEGIN INSERT INTO benchmark_writes VALUES(new.id); END`)
    for (let i = 0; i < 3; i++) {
      const current = getSession(sessions[0].id)!
      current.messages[499].content += ` edit-${i}`
      const result = await sample(() => { saveSessionMessages(current.id, current.messages); assert.equal(flushDatabase().error, null) })
      updates.push({ durationMs: result.durationMs, eventLoopDelayMs: result.eventLoopDelayMs })
    }
    const updatedRows = sql ? (sql.prepare('SELECT count(*) AS n FROM benchmark_writes').get() as { n: number }).n : null
    if (sql) { assert.equal(updatedRows, 3); sql.exec('DROP TRIGGER benchmark_update; DROP TABLE benchmark_writes'); sql.close() }
    const restart = await sample(initDatabase)
    const restored = getSession(sessions[0].id)!
    assert.match(restored.messages[499].content, /edit-0 edit-1 edit-2$/)
    assert.equal(restored.messages[0].imageUrl, 'data:image/png;base64,AQID')
    assert.equal(restored.messages[1].replyReadAt, 2)
    assert.equal(restored.messages[1].communication?.source.kind, 'conversation')
    report.conversations.push({ count, sessions: sessions.length, startup: { durationMs: startup.durationMs, eventLoopDelayMs: startup.eventLoopDelayMs },
      search: { durationMs: search.durationMs, eventLoopDelayMs: search.eventLoopDelayMs }, restartMs: restart.durationMs, updatedRows,
      updates, fileBytes: bytes(dir), validatedMessages: count, validatedAttachment: true })
  }
  for (const count of [10, 100, 300]) {
    const dir = path.join(root, `deliveries-${count}`)
    fs.mkdirSync(dir)
    const store = new ContactTaskStore(path.join(dir, 'agents.db'))
    try {
      store.ensure('benchmark')
      const topic = store.topics.create('benchmark', { title: 'Book', goal: 'Write chapters', constraints: '' })
      const write = await sample(() => {
        for (let i = 1; i <= count; i++) {
          const runId = store.createRun('benchmark', '', i, topic.id)
          store.finish(runId, { runId, title: `Chapter ${i}`, body: 'saved', nextStep: 'Continue writing', evidence: [], createdAt: i }, [],
            { status: 'researching', judgement: 'saved', openQuestions: '', nextStep: 'Continue writing', reason: 'chapter' },
            { completionCriteria: 'All chapters', summary: 'saved', stages: [{ id: 'write', title: 'Write', status: 'active' }],
              section: { id: `chapter-${i}`, title: `Chapter ${i}`, body: `${i}:`.padEnd(2000, 'x') } })
        }
      })
      const read = await sample(() => store.deliveries.get(topic.id, count)!)
      assert.equal(read.value.sections.length, count)
      assert.equal(store.deliveries.get(topic.id, 1)!.sections.length, 1)
      const exported = await sample(() => ({ md: deliveryMarkdown('Book', read.value), html: deliveryHtmlExport('Book', read.value, 'benchmark') }))
      for (let i = 1; i <= count; i++) {
        const body = `${i}:`.padEnd(2000, 'x')
        assert.equal(read.value.sections[i - 1].body, body)
        assert.ok(exported.value.md.includes(body)); assert.ok(exported.value.html.includes(body))
      }
      const snapshots = store.db.prepare('SELECT SUM(length(CAST(value AS BLOB))) AS n FROM delivery_versions').get() as { n: number }
      const hasBlocks = store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='delivery_blocks'").get()
      const blockBytes = hasBlocks ? (store.db.prepare('SELECT SUM(length(CAST(body AS BLOB))) AS n FROM delivery_blocks').get() as { n: number }).n : null
      if (hasBlocks) assert.equal(blockBytes, count * 2000)
      const indexBodyBytes = hasBlocks ? (store.db.prepare('SELECT SUM(length(CAST(text AS BLOB))+length(CAST(search_text AS BLOB))) AS n FROM portfolio_texts').get() as { n: number }).n : null
      const indexManifestBytes = (store.db.prepare('SELECT SUM(length(CAST(sections AS BLOB))+length(CAST(search_text AS BLOB))) AS n FROM portfolio_versions').get() as { n: number }).n
      report.deliveries.push({ count, write: { durationMs: write.durationMs, eventLoopDelayMs: write.eventLoopDelayMs },
        readMs: read.durationMs, exportMs: exported.durationMs, snapshotOrManifestBytes: snapshots.n, uniqueBodyBytes: count * 2000,
        storedBlockBytes: blockBytes, indexBodyBytes, indexManifestBytes, fileBytes: bytes(dir), validatedVersions: [1, count], validatedSections: count })
    } finally { store.close() }
  }
  app.setPath('userData', root)
  console.log('CHOUYU_STORAGE_REPORT ' + JSON.stringify(report))
}
