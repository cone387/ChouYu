import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { taskRequestPayload, validateTaskRequestSource, type TaskRequestSubmission, type TaskRequestReceipt, type TaskRequestEffect, type TaskRequestRecord, type TaskRequestPage, type TaskRequestAttempt } from '../../../shared/contact-task-requests'

interface Row { id: number; character_id: string; request_id: string; fingerprint: string; source: string; tool: string; topic_id: string | null; revision: number; effect: TaskRequestEffect; saved_at: number }
type Mutation = { topicId: string; effect: TaskRequestEffect; runId?: string; deletedRevision?: number }

/** Shares the task transaction; neither a chat acknowledgement nor a queued run is proof of work. */
export class ContactTaskRequests {
  constructor(private db: Database.Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS contact_task_requests (
      id INTEGER PRIMARY KEY, character_id TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE,
      request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, source TEXT NOT NULL, tool TEXT NOT NULL,
      topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL, revision INTEGER NOT NULL, effect TEXT NOT NULL, saved_at INTEGER NOT NULL,
      UNIQUE(character_id, request_id));
      CREATE INDEX IF NOT EXISTS task_requests_topic ON contact_task_requests(character_id,topic_id,id);
      CREATE TABLE IF NOT EXISTS contact_task_request_runs (
        request_id INTEGER NOT NULL REFERENCES contact_task_requests(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        linked_at INTEGER NOT NULL, supplied_at INTEGER, result_version INTEGER,
        PRIMARY KEY(request_id,run_id));
      CREATE TRIGGER IF NOT EXISTS task_requests_delete_source BEFORE DELETE ON topics BEGIN
        UPDATE contact_task_requests SET source=json_set(source,'$.text','') WHERE topic_id=OLD.id AND character_id=OLD.character_id;
      END;`)
  }
  private fingerprint(input: TaskRequestSubmission) { return createHash('sha256').update(taskRequestPayload(input)).digest('hex') }
  private receipt(row: Row): TaskRequestReceipt {
    return { requestId: row.request_id, topicId: row.topic_id, revision: row.revision, effect: row.effect, savedAt: row.saved_at }
  }
  get(owner: string, input: TaskRequestSubmission): TaskRequestReceipt | null {
    const fingerprint = this.fingerprint(input)
    const row = this.db.prepare('SELECT * FROM contact_task_requests WHERE character_id=? AND request_id=?').get(owner, input.source.requestId) as Row | undefined
    if (!row) return null
    if (row.fingerprint !== fingerprint) throw new Error('同一请求已对应另一项操作，不能替换目标或要求。')
    return this.receipt(row)
  }
  apply(owner: string, input: TaskRequestSubmission, mutate: () => Mutation): TaskRequestReceipt {
    const fingerprint = this.fingerprint(input), source = validateTaskRequestSource(input.source)
    return this.db.transaction(() => {
      const previous = this.get(owner, input)
      if (previous) return previous
      const result = mutate()
      if (!result || typeof result.topicId !== 'string' || !['requirements', 'assignment', 'revision', 'answer', 'control'].includes(result.effect) || 'then' in result) throw new Error('任务请求必须在同步事务内保存。')
      const topic = this.db.prepare('SELECT value FROM topics WHERE id=? AND character_id=?').get(result.topicId, owner) as { value: string } | undefined
      if (!topic && result.deletedRevision === undefined) throw new Error('任务请求不属于当前联系人。')
      const savedAt = Date.now(), revision = topic ? JSON.parse(topic.value).revision as number : result.deletedRevision!
      const savedTopic = topic ? result.topicId : null
      this.db.prepare('INSERT INTO contact_task_requests(character_id,request_id,fingerprint,source,tool,topic_id,revision,effect,saved_at) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(owner, source.requestId, fingerprint, JSON.stringify(savedTopic ? source : { ...source, text: '' }), input.tool, savedTopic, revision, result.effect, savedAt)
      if (result.runId) this.bindRun(result.runId)
      return { requestId: source.requestId, topicId: savedTopic, revision, effect: result.effect, savedAt }
    }).immediate()
  }
  list(owner: string, topicId: string, cursor?: number, limit = 20): TaskRequestPage {
    if (!this.db.prepare('SELECT 1 FROM topics WHERE id=? AND character_id=?').get(topicId, owner)) throw new Error('找不到此联系人的任务。')
    if (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 1) || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('请求记录分页参数无效。')
    const rows = this.db.prepare('SELECT * FROM contact_task_requests WHERE character_id=? AND topic_id=? AND id<? ORDER BY id DESC LIMIT ?').all(owner, topicId, cursor ?? Number.MAX_SAFE_INTEGER, limit + 1) as Row[]
    const items = rows.slice(0, limit).map(row => this.view(row))
    return { items, ...(rows.length > limit ? { nextCursor: items.at(-1)!.id } : {}) }
  }
  private view(row: Row): TaskRequestRecord {
    const attempts = this.db.prepare(`SELECT a.run_id AS runId,a.linked_at AS linkedAt,a.supplied_at AS suppliedAt,a.result_version AS resultVersion,r.status
      FROM contact_task_request_runs a JOIN runs r ON r.id=a.run_id WHERE a.request_id=? ORDER BY a.linked_at DESC,a.rowid DESC LIMIT 20`).all(row.id) as TaskRequestAttempt[]
    for (const attempt of attempts) { if (attempt.suppliedAt == null) delete attempt.suppliedAt; if (attempt.resultVersion == null) delete attempt.resultVersion }
    const latest = attempts[0]
    const status = !row.topic_id ? 'deleted' : attempts.some(a => a.resultVersion !== undefined) ? 'result-saved'
      : latest ? latest.status === 'completed' ? 'no-result' : latest.status : 'saved'
    return { ...this.receipt(row), id: row.id, source: JSON.parse(row.source), tool: row.tool, status, attempts }
  }
  bindRun(runId: string) {
    const run = this.live(runId)
    this.db.prepare(`INSERT OR IGNORE INTO contact_task_request_runs(request_id,run_id,linked_at)
      SELECT q.id,?,? FROM contact_task_requests q WHERE q.character_id=? AND q.topic_id=? AND q.revision<=? AND q.effect<>'control'
      AND NOT EXISTS(SELECT 1 FROM contact_task_request_runs a WHERE a.request_id=q.id AND a.result_version IS NOT NULL)`)
      .run(runId, Date.now(), run.character_id, run.topic_id, run.topic_revision)
  }
  context(runId: string): { id: number; text: string; effect: TaskRequestEffect }[] {
    this.live(runId)
    return this.db.prepare(`SELECT q.id,json_extract(q.source,'$.text') AS text,q.effect FROM contact_task_requests q
      JOIN contact_task_request_runs a ON a.request_id=q.id WHERE a.run_id=? ORDER BY q.id`).all(runId) as { id: number; text: string; effect: TaskRequestEffect }[]
  }
  /** A response to the actual request proves its context was submitted, not that each requirement was fulfilled. */
  supplied(runId: string, requestIds: readonly number[]) {
    this.live(runId)
    const update = this.db.prepare('UPDATE contact_task_request_runs SET supplied_at=COALESCE(supplied_at,?) WHERE run_id=? AND request_id=?')
    this.db.transaction(() => { const at = Date.now(); for (const id of requestIds) update.run(at, runId, id) })()
  }
  complete(runId: string, version: number) {
    const run = this.live(runId)
    if (!Number.isSafeInteger(version) || !this.db.prepare('SELECT 1 FROM delivery_versions WHERE topic_id=? AND version=? AND run_id=?').get(run.topic_id, version, runId)) throw new Error('请求结果必须关联实际保存的成果。')
    this.db.prepare('UPDATE contact_task_request_runs SET result_version=? WHERE run_id=? AND supplied_at IS NOT NULL').run(version, runId)
  }
  private live(runId: string) {
    const run = this.db.prepare(`SELECT r.character_id,r.topic_id,r.topic_revision,r.status,json_extract(t.value,'$.revision') AS current_revision
      FROM runs r JOIN topics t ON t.id=r.topic_id AND t.character_id=r.character_id WHERE r.id=?`).get(runId) as { character_id: string; topic_id: string; topic_revision: number; current_revision: number; status: string } | undefined
    if (!run || !['queued', 'running', 'waiting', 'interrupted'].includes(run.status) || run.topic_revision !== run.current_revision) throw new Error('任务执行或版本已变化，旧轮次不能处理请求。')
    return run
  }
}
