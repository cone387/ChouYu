import { contactFailure } from '../../shared/contact-failure'
import { createHash } from 'node:crypto'
import { agentUsesPlanner, type AgentNotice, type AgentSettings } from '../../shared/agents'
import type { ContactBudgetField, ContactInteraction, ContactInteractionSubmission } from '../../shared/contact-interactions'
import type { AgentStore } from './store'

type RecordValue = ContactInteraction & { topicRevision: number; settingsGuard: string; questionEventId?: number }
const settingsGuard = (s: AgentSettings) => JSON.stringify([s.enabled, s.paceWriting, s.workHours, s.permissionLevel, s.sources, s.readContactDeliveries, s.shareDeliveries, s.searchEnabled])

/** Persist decisions separately from messages. All mutations share the task database transaction. */
export class ContactInteractions {
  constructor(private store: AgentStore) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS contact_interactions (
      id TEXT PRIMARY KEY, character_id TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE,
      value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS contact_interactions_owner ON contact_interactions(character_id);`)
  }
  private save(value: RecordValue) {
    this.store.db.prepare('INSERT INTO contact_interactions VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(value.id, value.characterId, JSON.stringify(value))
  }
  offer(notice: AgentNotice): string | undefined {
    const profile = this.store.profile(notice.characterId)
    if (!profile) return
    const settings = JSON.parse(profile.settings) as AgentSettings
    const kind = notice.kind === 'question' ? 'question' : notice.purpose === 'resources' ? 'budget'
      : notice.purpose === 'failure' && (profile.failures >= 3 || !settings.enabled) ? 'retry' : undefined
    if (!kind) return
    const existing = this.store.db.prepare('SELECT id FROM contact_interactions WHERE id=?').get(notice.id)
    if (existing) return notice.id
    const topic = this.store.topics.get(notice.characterId, notice.topicId), run = this.store.getRun(notice.runId)
    if (!run || run.character_id !== notice.characterId || run.topic_id !== topic.id) throw new Error('交互事项来源不匹配。')
    this.save({ id: notice.id, version: '', characterId: notice.characterId, topicId: topic.id, runId: run.id,
      topicTitle: topic.title, kind, status: 'pending', budgets: [], createdAt: notice.createdAt,
      ...(kind === 'question' ? { question: run.question, questionEventId: (this.store.db.prepare("SELECT MAX(id) AS id FROM events WHERE run_id=? AND kind='waiting'").get(run.id) as { id: number }).id } : {}), topicRevision: topic.revision, settingsGuard: settingsGuard(settings) })
    return notice.id
  }
  pending(owner: string): ContactInteraction[] {
    const rows = this.store.db.prepare("SELECT id FROM contact_interactions WHERE character_id=? AND json_extract(value,'$.status')='pending'").all(owner) as { id: string }[]
    return rows.map(row => this.get(owner, row.id)).filter(view => view.status === 'pending')
  }
  /** Upgrade only a still-current blocker/question, once. Historical messages are never rewritten. */
  publishOutstanding(owner: string, visibleNoticeIds?: ReadonlySet<string>) {
    const rows = this.store.db.prepare("SELECT value FROM notices WHERE character_id=? AND json_extract(value,'$.interactionId') IS NULL ORDER BY rowid DESC").all(owner) as { value: string }[]
    const seen = new Set<string>()
    for (const row of rows) {
      const notice = JSON.parse(row.value) as AgentNotice
      if (visibleNoticeIds && !visibleNoticeIds.has(notice.id)) continue
      if (seen.has(notice.topicId) || !['resources', 'failure'].includes(notice.purpose ?? '') && notice.kind !== 'question') continue
      const run = this.store.getRun(notice.runId)
      const topicRow = this.store.db.prepare('SELECT value FROM topics WHERE id=? AND character_id=?').get(notice.topicId, owner) as { value: string } | undefined
      const latest = this.store.db.prepare('SELECT id FROM runs WHERE topic_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(notice.topicId) as { id: string } | undefined
      if (!run || !topicRow || latest?.id !== run.id || JSON.parse(topicRow.value).revision !== notice.topicRevision) continue
      if (notice.kind === 'question' && (run.status !== 'waiting' || !notice.content.includes(run.question))) continue
      seen.add(notice.topicId)
      const candidate = { ...notice, id: `${notice.id}:interaction`, createdAt: Date.now() }
      const id = this.offer(candidate)
      if (id && this.get(owner, id).status === 'pending') this.store.notices.enqueue(candidate)
    }
  }
  checkScheduledResources(owner: string) {
    const s = this.store, profile = s.profile(owner)!
    const settings = JSON.parse(profile.settings) as AgentSettings
    if (!settings.enabled || profile.failures >= 3) return
    const live = s.db.prepare("SELECT * FROM runs WHERE character_id=? AND status IN ('queued','interrupted') ORDER BY created_at LIMIT 1").get(owner) as ReturnType<AgentStore['getRun']>
    const scheduled = s.scheduled(owner).find(task => task.next_at <= Date.now())
    const run = live ?? (scheduled && s.db.prepare('SELECT * FROM runs WHERE topic_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(scheduled.topic_id)) as ReturnType<AgentStore['getRun']>
    if (!run?.topic_id) return
    const topic = s.topics.get(owner, run.topic_id)
    if (['paused', 'completed', 'abandoned'].includes(topic.status) || !['completed', 'queued', 'interrupted'].includes(run.status)) return
    const candidate = { characterId: owner, topicId: topic.id, runId: run.id } as RecordValue
    if (!this.fields(candidate).length || this.pending(owner).some(v => v.topicId === topic.id)) return
    const day = new Date().toLocaleDateString('en-CA')
    s.notices.enqueue({ id: `${run.id}:resource-check:${day}`, characterId: owner, topicId: topic.id, runId: run.id,
      topicRevision: topic.revision, kind: 'progress', purpose: 'resources', createdAt: Date.now(), content: `「${topic.title}」暂时无法继续，当前额度不足。已有成果保留，可以在这里调整额度。` })
  }
  private read(owner: string, id: string): RecordValue {
    const row = this.store.db.prepare('SELECT value FROM contact_interactions WHERE id=? AND character_id=?').get(id, owner) as { value: string } | undefined
    if (!row) throw new Error('待处理事项不存在或不属于此联系人。')
    return JSON.parse(row.value)
  }
  private fields(v: RecordValue): ContactBudgetField[] {
    const s = this.store, run = s.getRun(v.runId)!, topic = s.topics.get(v.characterId, v.topicId)
    const settings = JSON.parse(s.profile(v.characterId)!.settings) as AgentSettings
    const continuing = ['waiting', 'queued', 'interrupted'].includes(run.status)
    const callsNeeded = continuing ? s.callsNeededToResume(run.id) : agentUsesPlanner(settings) ? 2 : 1
    const block = s.db.prepare('SELECT needed FROM token_blocks WHERE run_id=?').get(run.id) as { needed: number } | undefined
    const usage = s.tokens.usage(v.characterId), fields: ContactBudgetField[] = []
    const add = (key: ContactBudgetField['key'], label: string, unit: string, used: number, limit: number | undefined, needed: number, max: number) => {
      if (limit !== undefined && used + needed > limit) fields.push({ key, label, unit, used, limit, needed, max })
    }
    add('taskCalls', '任务累计调用上限', '次', s.taskCallCount(v.characterId, v.topicId), topic.resourceBudget?.modelCalls, callsNeeded, 10000)
    add('dailyCalls', '联系人每日调用上限', '次', s.callCount(v.characterId), settings.dailyCalls, callsNeeded, 10000)
    add('taskTokens', '任务累计 Token 上限', 'Token', usage.tasks[v.topicId] ?? 0, topic.tokenLimit, block?.needed ?? 1, 1000000000)
    add('dailyTokens', '联系人每日 Token 上限', 'Token', usage.today, settings.dailyTokenLimit, block?.needed ?? 1, 1000000000)
    return fields
  }
  get(owner: string, id: string): ContactInteraction {
    const v = this.read(owner, id), s = this.store
    if (v.kind === 'retry') v.failure = contactFailure(s.getRun(v.runId)?.error ?? '')
    if (v.status === 'pending') {
      const run = s.getRun(v.runId)
      const row = s.db.prepare('SELECT value FROM topics WHERE character_id=? AND id=?').get(owner, v.topicId) as { value: string } | undefined
      const topic = row ? JSON.parse(row.value) : undefined
      const profile = s.profile(owner)
      const newer = s.db.prepare('SELECT id FROM runs WHERE topic_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(v.topicId) as { id: string } | undefined
      if (v.kind === 'question' && s.db.prepare("SELECT 1 FROM events WHERE run_id=? AND kind='answer' AND id>?").get(v.runId, v.questionEventId ?? Number.MAX_SAFE_INTEGER)) {
        v.status = 'resolved'; v.result = '已收到回复'
      } else if (!run || !topic || !profile || topic.revision !== v.topicRevision || settingsGuard(JSON.parse(profile.settings)) !== v.settingsGuard
        || ['completed', 'abandoned'].includes(topic.status) || newer?.id !== v.runId
        || v.kind === 'question' && (run.status !== 'waiting' || run.question !== v.question)
        || v.kind === 'retry' && (run.status !== 'failed' || topic.status === 'paused')) {
        v.status = 'obsolete'; v.result = '任务状态已变化，此操作已失效'
      } else {
        v.budgets = this.fields(v)
        if (v.kind === 'budget' && !v.budgets.length) {
          v.status = 'resolved'; v.result = topic.status === 'paused' ? '额度限制已解除；任务仍暂停，可在任务中继续' : '额度限制已解除'
        }
      }
      if (v.status !== 'pending') this.save(v)
    }
    const { topicRevision: _revision, settingsGuard: _settings, questionEventId: _event, ...view } = v
    view.version = createHash('sha256').update(JSON.stringify([v.id, v.topicRevision, v.settingsGuard, v.budgets.map(f => [f.key, f.limit])])).digest('hex')
    return view
  }
  submit(owner: string, id: string, raw: ContactInteractionSubmission, conversation: string): ContactInteraction {
    // Resolving obsolete state happens outside the mutation transaction, so a rejected click stays obsolete.
    const current = this.get(owner, id)
    if (current.status === 'resolved') return current
    if (current.status !== 'pending') throw new Error(current.result)
    if (!raw || raw.version !== current.version) throw new Error('额度或任务已变化，请核对卡片后重新提交。')
    return this.store.db.transaction(() => {
      const current = this.get(owner, id)
      if (current.status === 'resolved') return current
      if (current.status !== 'pending' || raw.version !== current.version) throw new Error('额度或任务已变化，请核对卡片后重新提交。')
      const s = this.store, record = this.read(owner, id)
      const limits = raw.limits ?? {}
      if (typeof limits !== 'object' || Array.isArray(limits) || Object.keys(limits).some(key => !current.budgets.some(f => f.key === key))) throw new Error('只能调整卡片中当前受限的额度。')
      for (const field of current.budgets) {
        const limit = limits[field.key]
        if (!Number.isSafeInteger(limit) || limit! < field.used + field.needed || limit! > field.max) throw new Error(`${field.label}至少需要 ${field.used + field.needed} ${field.unit}，最多 ${field.max}。`)
      }
      let topic = s.topics.get(owner, current.topicId)
      if (limits.taskCalls !== undefined) topic = s.topics.budget(owner, topic.id, topic.revision, { modelCalls: limits.taskCalls, reason: '用户通过聊天卡片调整任务调用额度。' })
      if (limits.taskTokens !== undefined) topic = s.topics.tokenBudget(owner, topic.id, topic.revision, limits.taskTokens)
      if (limits.dailyCalls !== undefined || limits.dailyTokens !== undefined) {
        const profile = s.profile(owner)!, settings = JSON.parse(profile.settings) as AgentSettings
        s.save(owner, { ...settings, ...(limits.dailyCalls === undefined ? {} : { dailyCalls: limits.dailyCalls }),
          ...(limits.dailyTokens === undefined ? {} : { dailyTokenLimit: limits.dailyTokens }) }, Date.now(), false, profile.revision)
      }
      const run = s.getRun(current.runId)!
      if (topic.revision !== record.topicRevision) {
        const input = JSON.parse(run.input); input.topic = topic
        s.db.prepare('UPDATE runs SET input=? WHERE id=?').run(JSON.stringify(input), run.id)
      }
      if (current.kind === 'question') {
        // Preserve the waiting checkpoint while accounting for a budget revision made by this very action.
        s.db.prepare('UPDATE runs SET topic_revision=? WHERE id=?').run(topic.revision, run.id)
        s.answer(owner, run.id, raw.answer ?? '')
        record.result = '已收到回复，本轮已排队继续'
      } else if (current.kind === 'budget' && ['queued', 'interrupted'].includes(run.status) && topic.status !== 'paused') {
        s.db.prepare("UPDATE runs SET status='queued',topic_revision=? WHERE id=?").run(topic.revision, run.id)
        record.result = '额度已调整，本轮已排队继续'
      } else {
        s.continueTopic(owner, topic.id, topic.revision, current.kind === 'budget' ? '用户通过聊天卡片调整额度并继续。' : '用户通过聊天卡片重试本任务。', conversation)
        record.result = current.kind === 'budget' ? '额度已调整，任务已排队' : '已重试，任务已排队'
      }
      record.status = 'resolved'; record.budgets = current.budgets
      this.save(record)
      s.event(current.runId, 'interaction-resolved', record.result)
      return this.get(owner, id)
    }).immediate()
  }
}
