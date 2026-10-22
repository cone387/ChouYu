import { containsSecret } from '../../shared/memory'
import type { DeliveryFeedbackInput, DeliveryFeedbackReceipt, DeliveryFeedbackRecord } from '../../shared/delivery-feedback'
import type { ContactTaskStore } from '../task-center/contact-store'

type Row = { id: number; character_id: string; topic_id: string; version: number; action: 'accept' | 'revise'; reason: string; at: number
  request_id: string | null; fingerprint: string | null; run_id: string | null; result_version: number | null }

/** Feedback and its revision are one durable request in the original task database. */
export class FeedbackLedger {
  constructor(private store: ContactTaskStore) {
    const db = store.db
    db.exec(`CREATE TABLE IF NOT EXISTS contact_delivery_feedback (
      id INTEGER PRIMARY KEY, character_id TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE,
      topic_id TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE, version INTEGER NOT NULL,
      action TEXT NOT NULL, reason TEXT NOT NULL, at INTEGER NOT NULL)`)
    const columns = new Set((db.pragma('table_info(contact_delivery_feedback)') as { name: string }[]).map(c => c.name))
    for (const [name, type] of [['request_id', 'TEXT'], ['fingerprint', 'TEXT'], ['run_id', 'TEXT REFERENCES runs(id) ON DELETE SET NULL'], ['result_version', 'INTEGER']]) {
      if (!columns.has(name)) db.exec(`ALTER TABLE contact_delivery_feedback ADD COLUMN ${name} ${type}`)
    }
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS feedback_request ON contact_delivery_feedback(character_id,request_id) WHERE request_id IS NOT NULL')
  }
  hasRequest(owner: string, requestId: string): boolean {
    return Boolean(this.store.db.prepare('SELECT 1 FROM contact_delivery_feedback WHERE character_id=? AND request_id=?').get(owner, requestId))
  }
  private receipt(row: Row): DeliveryFeedbackReceipt {
    return { saved: true, feedbackId: row.id, requestId: row.request_id!, topicId: row.topic_id, version: row.version, action: row.action,
      ...(row.run_id ? { runId: row.run_id } : {}), workCompleted: false,
      message: row.action === 'accept' ? `已记录你对版本 ${row.version} 的认可，任务保持原状态。` : `已保存对版本 ${row.version} 的修改意见并提交修订，可在反馈记录中查看实际结果。` }
  }
  submit(owner: string, input: DeliveryFeedbackInput): DeliveryFeedbackReceipt {
    if (!input || typeof input.requestId !== 'string' || !/^[\w:./-]{1,240}$/.test(input.requestId)) throw new Error('成果反馈请求标识无效。')
    if (!['accept', 'revise'].includes(input.action) || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 2000 || containsSecret(input.reason)) throw new Error('成果反馈无效。')
    if (input.scope !== undefined && !['content', 'presentation'].includes(input.scope)) throw new Error('成果修订范围无效。')
    if (input.citation && (input.citation.ref.characterId !== owner || input.citation.ref.topicId !== input.topicId || input.citation.ref.version !== input.version)) throw new Error('反馈引用与版本不一致。')
    const reason = input.reason.trim(), fingerprint = JSON.stringify([input.topicId, input.revision, input.version, input.action, reason, input.citation, input.scope ?? 'content'])
    return this.store.db.transaction(() => {
      const topic = this.store.topics.get(owner, input.topicId)
      const previous = this.store.db.prepare('SELECT * FROM contact_delivery_feedback WHERE character_id=? AND request_id=?').get(owner, input.requestId) as Row | undefined
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new Error('该请求标识已用于另一条成果反馈。')
        return this.receipt(previous)
      }
      if (topic.revision !== input.revision) throw new Error('任务已变化，请重新读取。')
      if (!Number.isSafeInteger(input.version) || this.store.deliveries.get(input.topicId)?.version !== input.version) throw new Error('成果版本已变化，请核对当前版本后再反馈。')
      const runId = input.action !== 'revise' ? null : input.scope === 'presentation'
        ? this.store.revisePresentation(owner, input.topicId, input.revision, reason, input.conversation ?? '', input.version)
        : this.store.reviseCitation(owner, input.revision, input.citation ?? { ref: { characterId: owner, topicId: input.topicId, version: input.version } }, reason, input.conversation ?? '')
      const inserted = this.store.db.prepare(`INSERT INTO contact_delivery_feedback(character_id,topic_id,version,action,reason,at,request_id,fingerprint,run_id) VALUES(?,?,?,?,?,?,?,?,?)`)
        .run(owner, input.topicId, input.version, input.action, reason, Date.now(), input.requestId, fingerprint, runId)
      return this.receipt(this.store.db.prepare('SELECT * FROM contact_delivery_feedback WHERE id=?').get(inserted.lastInsertRowid) as Row)
    }).immediate()
  }
  list(owner: string, topicId: string): DeliveryFeedbackRecord[] {
    this.store.topics.get(owner, topicId)
    const rows = this.store.db.prepare('SELECT * FROM contact_delivery_feedback WHERE character_id=? AND topic_id=? ORDER BY at DESC,id DESC').all(owner, topicId) as Row[]
    return rows.map(row => {
      const run = row.run_id ? this.store.getRun(row.run_id) : undefined
      const status = !row.request_id ? 'unlinked' : row.action === 'accept' ? 'accepted' : row.result_version ? 'completed'
        : !run ? 'unlinked' : run.status === 'completed' ? 'no-result' : run.status
      return { id: row.id, owner, topicId, ...(row.request_id ? { requestId: row.request_id } : {}), baseVersion: row.version,
        action: row.action, reason: row.reason, createdAt: row.at, ...(row.run_id ? { runId: row.run_id } : {}),
        ...(row.result_version ? { resultVersion: row.result_version } : {}), status }
    })
  }
  complete(runId: string, resultVersion: number): void {
    const run = this.store.getRun(runId)
    if (!run?.topic_id || !this.store.db.prepare('SELECT 1 FROM delivery_versions WHERE topic_id=? AND version=? AND run_id=?').get(run.topic_id, resultVersion, runId)) throw new Error('反馈修订尚无对应的正式成果。')
    this.store.db.prepare('UPDATE contact_delivery_feedback SET result_version=? WHERE run_id=? AND character_id=? AND topic_id=? AND result_version IS NULL')
      .run(resultVersion, runId, run.character_id, run.topic_id)
  }
}
