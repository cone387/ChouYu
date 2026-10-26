import { contactFailure } from '../../shared/contact-failure'
import { taskRecovery } from '../../shared/task-recovery'
import { readStoredDelivery } from './delivery-blocks'
import { containsSecret } from '../../shared/memory'
import { createHash } from 'node:crypto'
import { agentUsesPlanner, type AgentNotice, type AgentSettings } from '../../shared/agents'
import type { ContactBudgetField, ContactInteraction, ContactTaskInteraction, ContactInteractionSubmission } from '../../shared/contact-interactions'
import type { ContactTaskStore } from '../task-center/contact-store'
import { withinWorkHours } from '../../shared/work-settings'

type RecordValue = ContactTaskInteraction & { topicRevision: number; settingsGuard: string; questionEventId?: number }
const settingsGuard = (s: AgentSettings) => JSON.stringify([s.enabled, s.paceWriting, s.workHours, s.permissionLevel, s.sources, s.readContactDeliveries, s.shareDeliveries, s.searchEnabled])

/** Persist decisions separately from messages. All mutations share the task database transaction. */
export class ContactInteractions {
  constructor(private store: ContactTaskStore) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS contact_interactions (
      id TEXT PRIMARY KEY, character_id TEXT NOT NULL REFERENCES profiles(character_id) ON DELETE CASCADE,
      value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS contact_interactions_owner ON contact_interactions(character_id);`)
  }
  private save(value: RecordValue) {
    this.store.db.prepare('INSERT INTO contact_interactions VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(value.id, value.characterId, JSON.stringify(value))
  }
  failureImpact(runId: string): string {
    const s = this.store, run = s.getRun(runId)
    if (!run?.topic_id) return '这次尝试的保存情况无法核实。'
    const row = s.db.prepare("SELECT value FROM delivery_versions WHERE topic_id=? AND json_extract(value,'$.createdAt')<=? ORDER BY version DESC LIMIT 1").get(run.topic_id, run.updated_at) as { value: string } | undefined
    const saved = row && readStoredDelivery(s.db, row.value).sections.some(section => section.body.trim())
    const presentation = JSON.parse(run.input).revisionScope === 'presentation'
    const input = JSON.parse(run.input)
    const lengthDraft = input.deliveryLengthRepair?.original?.delivery?.section?.body || input.deliveryCountRepair?.original?.delivery?.section?.body
    const hasDraftTable = s.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='writing_drafts'").get()
    const draft = hasDraftTable && s.db.prepare("SELECT 1 FROM writing_drafts WHERE topic_id=? AND json_extract(value,'$.sourceRunId')=? AND updated_at<=? AND length(json_extract(value,'$.body'))>0 LIMIT 1").get(run.topic_id, run.id, run.updated_at)
    return (presentation ? '本次只修改阅读样式，未改动正文。' : '这次尝试没有保存新的正式正文。')
      + (saved ? '之前已保存的正文仍可在任务中查看。' : '截至这次中断，还没有已保存的正文。')
      + (lengthDraft ? '本轮未交付草稿已保留；再次尝试仍须满足原要求。' : draft ? '任务中另有未交付草稿；相同任务范围下继续时会尝试恢复。' : '')
  }
  offer(notice: AgentNotice): string | undefined {
    const profile = this.store.profile(notice.characterId)
    if (!profile) return
    const settings = JSON.parse(profile.settings) as AgentSettings
    const sourceRun = this.store.getRun(notice.runId)
    const kind = notice.kind === 'question' ? 'question' : notice.purpose === 'resources' ? 'budget'
      : notice.purpose === 'failure' || notice.purpose === 'presentation' && sourceRun?.status === 'failed' ? 'retry' : undefined
    if (!kind) return
    const existing = this.store.db.prepare('SELECT id FROM contact_interactions WHERE id=?').get(notice.id)
    if (existing) return notice.id
    const topic = this.store.topics.get(notice.characterId, notice.topicId), run = this.store.getRun(notice.runId)
    if (!run || run.character_id !== notice.characterId || run.topic_id !== topic.id) throw new Error('交互事项来源不匹配。')
    this.save({ id: notice.id, version: '', characterId: notice.characterId, topicId: topic.id, runId: run.id,
      topicTitle: topic.title, kind, status: 'pending', budgets: [], createdAt: notice.createdAt,
      ...(kind === 'retry' ? { impact: this.failureImpact(run.id) } : {}),
      ...(kind === 'question' ? { question: run.question, questionEventId: (this.store.db.prepare("SELECT MAX(id) AS id FROM events WHERE run_id=? AND kind='waiting'").get(run.id) as { id: number }).id } : {}), topicRevision: topic.revision, settingsGuard: settingsGuard(settings) })
    return notice.id
  }
  pending(owner: string): ContactInteraction[] {
    const rows = this.store.db.prepare("SELECT id FROM contact_interactions WHERE character_id=? AND json_extract(value,'$.status') IN ('pending','failed')").all(owner) as { id: string }[]
    const pending = rows.map(row => this.get(owner, row.id)).filter(view => ['pending', 'failed'].includes(view.status))
    if (this.store.recovery.identity(owner)) {
      if (!this.store.topics.list(owner).length && !this.store.recovery.identity(owner)!.scopeReviewed) pending.push(this.recoveryOwnerCard(owner))
      for (const topic of this.store.topics.list(owner)) {
        const card = this.recoveryCard(owner, topic.id)
        if (card.status === 'pending' && !pending.some(item => item.topicId === topic.id && item.storageRecovery)) pending.push(card)
      }
    }
    return pending
  }
  private recoveryOwnerCard(owner: string): ContactTaskInteraction {
    const recovery = this.store.recovery.identity(owner)
    if (!recovery) throw new Error('恢复记录已变化。')
    return { id: `restore-owner:${recovery.restoreId}`, characterId: owner, topicId: '', runId: '', topicTitle: '联系人恢复核对',
      version: `${recovery.restoreId}:${recovery.scopeReviewed}`, createdAt: recovery.restoredAt ?? 0,
      kind: 'retry', status: recovery.scopeReviewed ? 'resolved' : 'pending', budgets: [],
      storageRecovery: { restoreId: recovery.restoreId, unknownHistory: true, contactOnly: true },
      result: recovery.scopeReviewed ? '联系人资料与共享权限已核对；新任务仍需单独核对外部操作与新增额度。' : undefined,
      failure: { title: '联系人资料待核对', kind: 'storage', message: '此联系人没有可恢复的任务，请先核对恢复资料、记忆与共享权限。历史用量仍不完整。', action: '核对联系人资料', settings: false } }
  }
  private recoveryCard(owner: string, topicId: string, id?: string): ContactTaskInteraction {
    const recovery = this.store.recovery.identity(owner)
    if (!recovery) throw new Error('恢复记录已变化。')
    const topic = this.store.topics.get(owner, topicId)
    const run = this.store.db.prepare('SELECT id,status FROM runs WHERE character_id=? AND topic_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(owner, topicId) as { id: string; status: string } | undefined
    const started = recovery.allowedTopics.includes(topicId) && run && !this.store.recovery.oldRun(owner, run.id) && ['running', 'completed', 'waiting'].includes(run.status)
    return { id: id ?? `restore:${recovery.restoreId}:${topicId}`, characterId: owner, topicId, runId: run?.id ?? '', topicTitle: topic.title,
      version: `${recovery.restoreId}:${topic.revision}`, createdAt: topic.createdAt, kind: 'retry', status: started ? 'resolved' : 'pending',
      budgets: [], storageRecovery: { restoreId: recovery.restoreId, unknownHistory: true },
      result: started ? '已从核对后的正式成果开始新尝试；历史消耗仍不完整。' : undefined,
      impact: '旧轮次、检查点和待投递消息不会重放。恢复之后的新工作也须核对资料与额度。',
      failure: { kind: 'storage', message: '任务由备份恢复，资料、权限、外部操作和缺失用量需要核对。', action: '核对并开始新尝试', settings: false } }
  }
  /** Upgrade only a still-current blocker/question, once. Historical messages are never rewritten. */
  publishOutstanding(owner: string, visibleNoticeIds?: ReadonlySet<string>) {
    const rows = this.store.db.prepare("SELECT value FROM notices WHERE character_id=? AND json_extract(value,'$.interactionId') IS NULL ORDER BY rowid DESC").all(owner) as { value: string }[]
    const seen = new Set<string>()
    for (const row of rows) {
      const notice = JSON.parse(row.value) as AgentNotice
      if (visibleNoticeIds && !visibleNoticeIds.has(notice.id)) continue
      if (seen.has(notice.topicId) || !['resources', 'failure', 'presentation'].includes(notice.purpose ?? '') && notice.kind !== 'question') continue
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
    if (!settings.enabled) return
    const candidates = s.db.prepare("SELECT * FROM runs WHERE character_id=? AND status IN ('queued','interrupted') ORDER BY created_at,rowid").all(owner) as NonNullable<ReturnType<ContactTaskStore['getRun']>>[]
    for (const task of s.scheduled(owner).filter(task => task.next_at <= Date.now())) {
      const run = s.db.prepare('SELECT * FROM runs WHERE topic_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(task.topic_id) as ReturnType<ContactTaskStore['getRun']>
      if (run && !candidates.some(candidate => candidate.id === run.id)) candidates.push(run)
    }
    const pending = new Set(this.pending(owner).map(v => v.topicId))
    for (const run of candidates) {
      if (!run.topic_id) continue
      const topic = s.topics.get(owner, run.topic_id)
      if (['paused', 'completed', 'abandoned'].includes(topic.status) || !['completed', 'queued', 'interrupted'].includes(run.status)) continue
      const candidate = { characterId: owner, topicId: topic.id, runId: run.id } as RecordValue
      if (!this.fields(candidate).length || pending.has(topic.id)) continue
      const day = new Date().toLocaleDateString('en-CA')
      s.notices.enqueue({ id: `${run.id}:resource-check:${day}`, characterId: owner, topicId: topic.id, runId: run.id,
        topicRevision: topic.revision, kind: 'progress', purpose: 'resources', createdAt: Date.now(), content: `「${topic.title}」暂时无法继续，当前额度不足。已有成果保留，可以在这里调整额度。` })
      pending.add(topic.id)
    }
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
    const callsNeeded = continuing ? s.callsNeededToResume(run.id) : JSON.parse(run.input).revisionScope === 'presentation' ? 1 : agentUsesPlanner(settings) ? 2 : 1
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
    const recovery = this.store.recovery.identity(owner)
    if (recovery && id === `restore-owner:${recovery.restoreId}`) return this.recoveryOwnerCard(owner)
    const prefix = recovery && `restore:${recovery.restoreId}:`
    if (prefix && id.startsWith(prefix)) return this.recoveryCard(owner, id.slice(prefix.length), id)
    if (id.startsWith('action:')) {
      const card = this.store.actions.get(owner, id)
      if (recovery && this.store.recovery.original(owner).interactions.includes(id)) return {
        ...card, status: 'failed', retryable: false, result: '恢复前的外部操作结果可能不完整，原操作不会重放。请核对实际结果，再提出新的要求。'
      }
      return card
    }
    const v = this.read(owner, id), s = this.store
    if (recovery) return this.recoveryCard(owner, v.topicId, id)
    const sourceRun = s.getRun(v.runId)
    const presentation = sourceRun && JSON.parse(sourceRun.input).revisionScope === 'presentation'
    if (v.kind === 'retry') {
      const error = s.getRun(v.runId)?.error ?? ''
      v.failure = contactFailure(error)
      if (presentation) v.failure = { ...v.failure, title: '阅读样式修改中断', message: `这次阅读样式修改未完成。${v.failure.message}`, action: '重试本次样式修改' }
      v.failureDetail = containsSecret(error) || /Bearer\s+\S+|https?:\/\/[^\s]+[?@]/i.test(error)
        ? '原始诊断含有凭据或带参数的地址，已隐藏。请核对对应设置。' : error.slice(0, 600)
      if (sourceRun) v.impact ??= this.failureImpact(sourceRun.id)
      // These are a live projection, never a persisted promise from an older render.
      delete v.automaticRetryAt; delete v.recoveryMessage; delete v.currentState
    }
    if (v.status === 'pending') {
      const run = s.getRun(v.runId)
      const row = s.db.prepare('SELECT value FROM topics WHERE character_id=? AND id=?').get(owner, v.topicId) as { value: string } | undefined
      const topic = row ? JSON.parse(row.value) : undefined
      const profile = s.profile(owner)
      const newer = s.db.prepare('SELECT id FROM runs WHERE topic_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(v.topicId) as { id: string } | undefined
      if (v.kind === 'question' && s.db.prepare("SELECT 1 FROM events WHERE run_id=? AND kind='answer' AND id>?").get(v.runId, v.questionEventId ?? Number.MAX_SAFE_INTEGER)) {
        v.status = 'resolved'; v.result = '已收到回复'
      } else if (!run || !topic || !profile || topic.revision !== v.topicRevision || v.kind !== 'retry' && settingsGuard(JSON.parse(profile.settings)) !== v.settingsGuard
        || !presentation && ['completed', 'abandoned'].includes(topic.status) || newer?.id !== v.runId
        || presentation && s.deliveries.get(v.topicId)?.version !== JSON.parse(run.input).revisionBaseVersion
        || v.kind === 'question' && (run.status !== 'waiting' || run.question !== v.question)
        || v.kind === 'retry' && (run.status !== 'failed' || !presentation && topic.status === 'paused')) {
        v.status = 'obsolete'; v.result = '任务状态已变化，此操作已失效'
      } else {
        if (v.kind === 'retry') {
          const guard = settingsGuard(JSON.parse(profile.settings))
          if (guard !== v.settingsGuard) { v.settingsGuard = guard; this.save(v) }
        }
        v.budgets = this.fields(v)
        if (v.kind === 'budget' && !v.budgets.length) {
          v.status = 'resolved'; v.result = topic.status === 'paused' ? '额度限制已解除；任务仍暂停，可在任务中继续' : '额度限制已解除'
        }
      }
      if (v.status !== 'pending') this.save(v)
    }
    if (v.kind === 'retry' && v.status === 'pending' && !presentation) {
      const recovery = s.providerRecovery(owner, v.topicId)
      const settings = JSON.parse(s.profile(owner)!.settings) as AgentSettings
      const failure = s.taskFailures.get(v.topicId)
      v.automaticRetryAt = recovery?.runId === v.runId ? recovery.at
        : settings.enabled && failure?.run_id === v.runId && failure.failures < 3 ? failure.next_at : undefined
      if (v.budgets.length) {
        delete v.automaticRetryAt
        v.recoveryMessage = `当前${v.budgets.map(f => f.label).join('、')}不足以继续。请核对下方用量后调整；任务累计上限不会在明天重置。`
      } else if (!settings.enabled) v.recoveryMessage = '当前为按需工作，不会自动重试。准备好后可点“重新尝试”。'
      else if (!v.automaticRetryAt) v.recoveryMessage = failure && failure.failures >= 3
        ? `这项任务已连续失败 ${failure.failures} 次，自动重试已停止。请先处理上述原因，再手动重试。`
        : '当前没有自动重试安排，可手动重新尝试。'
      else {
        const at = v.automaticRetryAt
        const scheduled = at > Date.now() ? `已安排 ${new Date(at).toLocaleString()} 起自动重试。` : '已到自动重试时间，正在等待执行名额。'
        const hours = !withinWorkHours(settings) || !withinWorkHours(settings, at)
          ? `自动执行还需等到工作时段 ${settings.workHours!.start}–${settings.workHours!.end}。` : ''
        const action = v.failure?.settings || v.failure?.kind === 'storage'
          ? '请先按上述原因处理；重试安排不代表故障已解决。' : '你暂时不需要操作，也可以手动提前重试。'
        v.recoveryMessage = scheduled + hours + action
      }
    }
    if (v.kind === 'retry' && v.status === 'pending' && presentation) v.recoveryMessage = '这次样式修改不会自动重试。可按原修改要求重试，正文保持不变。'
    if (v.kind === 'retry' && v.status !== 'pending') {
      const topicRow = s.db.prepare('SELECT value FROM topics WHERE id=? AND character_id=?').get(v.topicId, owner) as { value: string } | undefined
      const topic = topicRow && JSON.parse(topicRow.value)
      const newer = s.db.prepare('SELECT id,status,error,input FROM runs WHERE topic_id=? AND character_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(v.topicId, owner) as { id: string; status: string; error: string; input: string } | undefined
      const newerPresentation = presentation && newer && newer.id !== v.runId && JSON.parse(newer.input).revisionScope === 'presentation'
      if (!topic) { v.currentState = 'deleted'; v.result = '任务已删除，此前的重试操作已失效。' }
      else if (['paused', 'completed', 'abandoned'].includes(topic.status) && !newerPresentation) {
        v.currentState = topic.status
        v.result = topic.status === 'paused' ? '任务已暂停，不会自动重试；需要时可在任务中继续。'
          : topic.status === 'completed' ? '任务现已完成，无需重试此前的失败。' : '任务已结束，不会再重试。'
      } else if (newer && newer.id !== v.runId) {
        const states: Record<string, string> = { queued: '已重新排队，无需重复点击重试。', running: '正在重新尝试，尚未完成；无需重复点击重试。', waiting: '后续尝试正在等待你的回复，请打开任务查看原问题。', completed: '后续尝试已完成；这不代表整个任务已经结束。', interrupted: '后续尝试已中断，等待恢复；请查看任务的当前状态。', cancelled: '后续尝试已取消；此前的重试操作已失效。' }
        v.currentState = newer.status === 'cancelled' ? 'changed' : newer.status as ContactTaskInteraction['currentState']
        v.result = newer.status === 'failed' ? `后续尝试仍受阻：${contactFailure(newer.error).message} 请查看最新的处理事项。` : states[newer.status]
      } else { v.currentState = 'changed'; v.result ??= '任务已变化，此前的操作已失效，请查看当前任务。' }
    }
    if (v.status === 'pending') v.recovery = taskRecovery({ topicId: v.topicId, revision: v.topicRevision, runId: v.runId,
      state: { code: v.kind === 'question' ? 'waiting' : v.budgets.length ? v.budgets.some(f => f.key.startsWith('task')) ? 'task-budget' : 'daily-budget' : v.automaticRetryAt === undefined ? 'failed' : 'retry', description: v.recoveryMessage ?? v.question ?? '' },
      error: sourceRun?.error, retryAt: v.automaticRetryAt, automatic: Boolean(v.automaticRetryAt) })
    else delete v.recovery
    const { topicRevision: _revision, settingsGuard: _settings, questionEventId: _event, ...view } = v
    view.version = createHash('sha256').update(JSON.stringify([v.id, v.topicRevision, v.settingsGuard, v.budgets.map(f => [f.key, f.limit])])).digest('hex')
    return view
  }
  submit(owner: string, id: string, raw: ContactInteractionSubmission, conversation: string): ContactInteraction {
    // Resolving obsolete state happens outside the mutation transaction, so a rejected click stays obsolete.
    const current = this.get(owner, id)
    if (current.kind === 'action') throw new Error('此事项须通过对应的实际操作处理。')
    if (current.status === 'resolved') return current
    if (current.status !== 'pending') throw new Error(current.result)
    if (!raw || raw.version !== current.version) throw new Error('额度或任务已变化，请核对卡片后重新提交。')
    return this.store.db.transaction(() => {
      const current = this.get(owner, id)
      if (current.kind === 'action') throw new Error('此事项须通过对应的实际操作处理。')
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
        const input = JSON.parse(run.input)
        if (input.revisionScope === 'presentation') {
          const retry = s.revisePresentation(owner, topic.id, topic.revision, input.feedback, conversation, input.revisionBaseVersion)
          s.feedbackLedger.resume(run.id, retry)
          record.result = '本次样式修改已排队重试，正文保持不变'
        } else {
          s.continueTopic(owner, topic.id, topic.revision, current.kind === 'budget' ? '用户通过聊天卡片调整额度并继续。' : '用户通过聊天卡片重试本任务。', conversation)
          record.result = current.kind === 'budget' ? '额度已调整，任务已排队' : '已重试，任务已排队'
        }
      }
      record.status = 'resolved'; record.budgets = current.budgets
      this.save(record)
      s.event(current.runId, 'interaction-resolved', record.result)
      return this.get(owner, id)
    }).immediate()
  }
}
