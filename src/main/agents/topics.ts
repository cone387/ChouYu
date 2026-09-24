import type Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { containsSecret } from '../../shared/memory'
import { validateTopicInput, validateTopicProgress, type AgentTopic, type AgentTopicChange, type AgentTopicDetail, type AgentTopicProgress, type AgentTopicStatus } from '../../shared/agents'

export const canResearch = (status: AgentTopicStatus) => ['planned', 'researching', 'needs_evidence'].includes(status)

/** Uses the same connection/transaction as runs and reports, so progress cannot commit alone. */
export class AgentTopics {
  constructor(private db: Database.Database) {}
  list(characterId: string): AgentTopic[] {
    return (this.db.prepare('SELECT value FROM topics WHERE character_id=? ORDER BY rowid DESC').all(characterId) as { value: string }[]).map(row => JSON.parse(row.value))
  }
  get(characterId: string, id: string): AgentTopic {
    const row = this.db.prepare('SELECT value FROM topics WHERE character_id=? AND id=?').get(characterId, id) as { value: string } | undefined
    if (!row) throw new Error('找不到此联系人的事项。')
    return JSON.parse(row.value)
  }
  check(characterId: string, id: string, revision: number) {
    const topic = this.get(characterId, id)
    if (topic.revision !== revision) throw new Error('事项已变化，请重新读取后再操作。')
    return topic
  }
  private record(before: AgentTopic | null, after: AgentTopic, kind: string, reason: string, runId: string | null = null) {
    this.db.prepare('INSERT INTO topic_changes(topic_id,kind,before_value,after_value,reason,run_id,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(after.id, kind, before ? JSON.stringify(before) : null, JSON.stringify(after), reason, runId, after.updatedAt)
    this.db.prepare('INSERT INTO topics(id,character_id,value) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(after.id, after.characterId, JSON.stringify(after))
  }
  create(characterId: string, raw: unknown, reason = '用户建立了持续研究事项。', now = Date.now()) {
    const input = validateTopicInput(raw)
    if (containsSecret(JSON.stringify(input))) throw new Error('请勿在事项中保存密码或密钥。')
    if (this.list(characterId).length >= 100) throw new Error('每位联系人最多保留 100 个事项。')
    const topic: AgentTopic = { ...input, id: randomUUID(), characterId, revision: 1, status: 'planned', judgement: '', openQuestions: '', nextStep: '', reason, createdAt: now, updatedAt: now }
    this.db.transaction(() => {
      // Insert the parent before its first history entry.
      this.db.prepare('INSERT INTO topics(id,character_id,value) VALUES(?,?,?)').run(topic.id, characterId, JSON.stringify(topic))
      this.record(null, topic, 'created', reason)
    })()
    return topic
  }
  edit(characterId: string, id: string, revision: number, raw: unknown, reason: string) {
    const before = this.check(characterId, id, revision), input = validateTopicInput(raw)
    this.reason(reason)
    if (containsSecret(JSON.stringify(input))) throw new Error('请勿在事项中保存密码或密钥。')
    const after = { ...before, ...input, revision: before.revision + 1, updatedAt: Date.now(), reason: reason.trim() }
    this.record(before, after, 'edited', after.reason)
    return after
  }
  plan(characterId: string, id: string, revision: number, title: string, nextStep: string, runId: string) {
    const before = this.check(characterId, id, revision)
    validateTopicInput({ ...before, title })
    if (!nextStep.trim() || nextStep.length > 1000 || containsSecret(title + nextStep)) throw new Error('任务方向无效。')
    const after = { ...before, title: title.trim(), nextStep: nextStep.trim(), revision: before.revision + 1, updatedAt: Date.now(), reason: '根据用户描述整理初步方向，尚未验证。' }
    this.record(before, after, 'planned', after.reason, runId)
    return after
  }
  status(characterId: string, id: string, revision: number, status: AgentTopicStatus, reason: string) {
    if (!['planned', 'paused', 'completed', 'abandoned'].includes(status)) throw new Error('请选择继续、暂停、结束或放弃。')
    const before = this.check(characterId, id, revision)
    this.reason(reason)
    const after = { ...before, status, revision: before.revision + 1, updatedAt: Date.now(), reason: reason.trim() }
    this.record(before, after, 'status', after.reason)
    return after
  }
  advance(characterId: string, id: string, revision: number, raw: AgentTopicProgress, runId: string) {
    const before = this.check(characterId, id, revision), progress = validateTopicProgress(raw)
    if (!canResearch(before.status)) throw new Error('此事项已暂停或结束。')
    const after = { ...before, ...progress, revision: before.revision + 1, updatedAt: Date.now() }
    this.record(before, after, 'research', progress.reason, runId)
  }
  detail(characterId: string, id: string, cursor?: number): AgentTopicDetail {
    const topic = this.get(characterId, id)
    if (cursor !== undefined && (!Number.isSafeInteger(cursor) || cursor < 1)) throw new Error('历史分页位置无效。')
    const rows = this.db.prepare('SELECT * FROM topic_changes WHERE topic_id=? AND id<? ORDER BY id DESC LIMIT 31').all(id, cursor ?? Number.MAX_SAFE_INTEGER) as { id: number; kind: string; before_value: string | null; after_value: string; reason: string; run_id: string | null; created_at: number }[]
    const changes: AgentTopicChange[] = rows.slice(0, 30).map(row => ({ id: row.id, kind: row.kind, before: row.before_value ? JSON.parse(row.before_value) : null, after: JSON.parse(row.after_value), reason: row.reason, runId: row.run_id, createdAt: row.created_at }))
    return { topic, changes, nextCursor: rows.length > 30 ? changes[changes.length - 1].id : null }
  }
  private reason(value: unknown) {
    if (typeof value !== 'string' || !value.trim() || value.length > 2000 || containsSecret(value)) throw new Error('请填写 1–2000 字的调整原因，不要包含密钥。')
  }
}
