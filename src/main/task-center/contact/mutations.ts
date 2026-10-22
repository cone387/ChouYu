import { providerRecoveryDelay } from '../../../shared/contact-failure';
import { ContactCalendars } from '../../agents/calendar';
import { validateRoutine } from '../../../shared/assistant-routines';
import { validateCalendarSchedule } from '../../../shared/calendar-schedule';
import { citationContext, validateCitation } from '../../agents/citations';
import { AgentMemories } from '../../agents/memories';
import { AgentMaterials } from '../../agents/materials';
import { AgentHandoffs } from '../../agents/handoffs';
import type { ContentCitation } from '../../../shared/contact-content';
import { AgentTaskFailures } from '../../agents/task-failures';
import { AgentTokenBudget } from '../../agents/token-budget';
import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import type { AgentSettings, AgentOverview, AgentRunStatus, AgentTopicStatus } from '../../../shared/agents';
import { agentUsesPlanner, DEFAULT_AGENT_SETTINGS, validateAgentSettings } from '../../../shared/agents';
import { containsSecret } from '../../../shared/memory';
import type { ContextReferences } from '../../../shared/contact-content';
import { type TaskResourceBudget } from '../../../shared/agent-resources';
import { AgentTopics, canResearch } from '../../agents/topics';
import { AgentNotices } from '../../agents/notices';
import { contactFailureReason } from '../../agents/contact-message';
import type { AgentResearch } from '../../../shared/agents';
import { AgentDeliveries } from '../../agents/delivery';
import { validateDeliveryPlan, type DeliveryPlan } from '../../../shared/agent-delivery';
import { workSettingsRequireRestart } from '../../../shared/work-settings';
import { appendTaskRequestLog } from '../../../shared/task-request-log';
import { RunRow, failureDelay } from './types';
import type { ContactStoreOperations } from './operations';
interface Ports {
  heartbeatRows: Map<string, { id: number; topicId: string; at: number; }>
  profile: ContactStoreOperations['profile']
  tokens: Pick<AgentTokenBudget, "usage">
  topics: Pick<AgentTopics, "get" | "list" | "create" | "status" | "tokenBudget" | "calendar" | "check" | "plan" | "edit" | "evaluationDelivery">
  scheduled: ContactStoreOperations['scheduled']
  research: ContactStoreOperations['research']
  overview: ContactStoreOperations['overview']
  materials: Pick<AgentMaterials, "get" | "read">
  memoryLibrary: Pick<AgentMemories, "get" | "create" | "forget" | "list">
  getRun: ContactStoreOperations['getRun']
  nextScheduledTopic: ContactStoreOperations['nextScheduledTopic']
  startScheduledTopic: ContactStoreOperations['startScheduledTopic']
  calendars: Pick<ContactCalendars, "save" | "get">
  deliveries: Pick<AgentDeliveries, "context" | "get">
  allocateTaskBudget: ContactStoreOperations['allocateTaskBudget']
  notices: Pick<AgentNotices, "enqueue">
  handoffs: Pick<AgentHandoffs, "checkRun">
  detail: ContactStoreOperations['detail']
  assertTaskBudget: ContactStoreOperations['assertTaskBudget']
  callCount: ContactStoreOperations['callCount']
  taskFailures: Pick<AgentTaskFailures, "get" | "set" | "refresh" | "clear">
  taskCallCount: ContactStoreOperations['taskCallCount']
  createRun: ContactStoreOperations['createRun']
  portfolio: import('../../agents/portfolio').AgentPortfolio
  setTaskBudget: ContactStoreOperations['setTaskBudget']
}

export class ContactMutations {
  constructor(private db: Database.Database, private ports: Ports) {}
  finishCleanup(characterId: string, requestId: string): void { this.db.prepare('DELETE FROM execution_cleanup WHERE character_id=? AND request_id=?').run(characterId, requestId) }
  ensure(id: string): void { this.db.prepare('INSERT OR IGNORE INTO profiles(character_id,settings,revision,next_at) VALUES(?,?,1,0)').run(id, JSON.stringify(DEFAULT_AGENT_SETTINGS)) }
  save(id: string, raw: unknown, now = Date.now(), createDefaultTopic = true, expectedRevision?: number, requestReason?: string): AgentOverview {
    const settings = validateAgentSettings(raw)
    this.ports.heartbeatRows.delete(id)
    const wasMissing = !this.ports.profile(id)
    this.ensure(id)
    this.db.transaction(() => {
      const profile = this.ports.profile(id)!
      if (expectedRevision !== undefined && profile.revision !== expectedRevision && !(wasMissing && expectedRevision === 0)) throw new Error('工作设置已变化，请重试以应用到最新设置。')
      const previous = JSON.parse(profile.settings) as AgentSettings
      if (requestReason !== undefined && (!requestReason.trim() || requestReason.length > 2000 || containsSecret(requestReason))) throw new Error('工作设置修改要求无效。')
      if (settings.dailyTokenLimit !== previous.dailyTokenLimit && settings.dailyTokenLimit !== undefined && settings.dailyTokenLimit < this.ports.tokens.usage(id, now).today) throw new Error('每日上限不能低于今日已消耗或预留的 Token 额度。')
      const restart = createDefaultTopic || workSettingsRequireRestart(previous, settings)
      if (restart) this.cancel(id, '工作权限或运行方式已更改，本轮停止，已有成果保留。', now)
      const nextAt = !previous.enabled && settings.enabled ? now : restart ? now : profile.next_at
      this.db.prepare('UPDATE profiles SET settings=?,revision=revision+1,next_at=? WHERE character_id=?').run(JSON.stringify(settings), nextAt, id)
      if (requestReason !== undefined) this.db.prepare('INSERT INTO work_settings_changes(character_id,revision,before_value,after_value,reason,created_at) VALUES(?,?,?,?,?,?)')
        .run(id, profile.revision + 1, JSON.stringify(previous), JSON.stringify(settings), requestReason, now)
      // Keep checkpointed rounds live while invalidating stale settings confirmations.
      if (!restart) this.db.prepare("UPDATE runs SET revision=? WHERE character_id=? AND revision=? AND status IN ('queued','running','waiting','interrupted')").run(profile.revision + 1, id, profile.revision)
      if ((settings.maxConcurrentTasks ?? 1) > 1 && (previous.maxConcurrentTasks ?? 1) === 1) {
        // Preserve work previously scheduled only by the serial contact focus, never idle history.
        const started = this.db.prepare(`SELECT DISTINCT topic_id FROM runs WHERE character_id=? AND topic_id IS NOT NULL
          AND (status IN ('queued','running','waiting','interrupted') OR topic_id=?)`).all(id, profile.focus_topic_id) as { topic_id: string }[]
        for (const task of started) if (canResearch(this.ports.topics.get(id, task.topic_id).status))
          this.db.prepare('INSERT OR IGNORE INTO task_schedule(topic_id,next_at) VALUES(?,?)').run(task.topic_id, profile.next_at)
      }
      if (settings.enabled && (settings.enabled !== previous.enabled || settings.paceWriting !== previous.paceWriting || settings.intervalMinutes !== previous.intervalMinutes)) {
        for (const task of [...this.ports.scheduled(id), ...(profile.focus_topic_id && !this.ports.scheduled(id).some(t => t.topic_id === profile.focus_topic_id) ? [{ topic_id: profile.focus_topic_id }] : [])]) {
          const last = this.db.prepare('SELECT * FROM runs WHERE topic_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(task.topic_id) as RunRow | undefined
          if (!last || last.status !== 'completed' || !canResearch(this.ports.topics.get(id, task.topic_id).status)) continue
          const research = this.ports.research(last.id)
          // A continuous-mode switch checks immediately; interval mode preserves explicit idle waits.
          if (research?.nextCheckAt && settings.paceWriting && !this.db.prepare('SELECT 1 FROM reports WHERE run_id=?').get(last.id)) continue
          const delay = !settings.paceWriting ? 0 : settings.intervalMinutes * 60000
          const nextAt = Math.max(now, last.updated_at + delay)
          this.db.prepare('UPDATE task_schedule SET next_at=? WHERE topic_id=?').run(nextAt, task.topic_id)
          if (profile.focus_topic_id === task.topic_id) this.db.prepare('UPDATE profiles SET next_at=? WHERE character_id=?').run(nextAt, id)
        }
      }
      if (createDefaultTopic && !this.ports.topics.list(id).length) {
        const topic = this.ports.topics.create(id, { title: settings.goal.slice(0, 160), goal: settings.goal, constraints: '' }, '由首次保存的工作方向建立。', now)
        this.db.prepare('UPDATE profiles SET focus_topic_id=? WHERE character_id=?').run(topic.id, id)
      }
    })()
    return this.ports.overview(id, now)
  }
  pause(id: string, reason = '用户暂停了持续工作。'): AgentOverview {
    this.ports.heartbeatRows.delete(id)
    this.ensure(id)
    const settings = { ...JSON.parse(this.ports.profile(id)!.settings), enabled: false }
    this.db.transaction(() => {
      for (const task of this.ports.scheduled(id)) {
        const topic = this.ports.topics.get(id, task.topic_id)
        if (canResearch(topic.status)) this.ports.topics.status(id, topic.id, topic.revision, 'paused', reason)
      }
      this.cancel(id, reason)
      this.db.prepare('UPDATE profiles SET settings=?,revision=revision+1 WHERE character_id=?').run(JSON.stringify(settings), id)
    })()
    return this.ports.overview(id)
  }
  cancel(id: string, reason: string, now = Date.now()): void {
    const rows = this.db.prepare("SELECT * FROM runs WHERE character_id=? AND status IN ('queued','running','waiting','interrupted')").all(id) as RunRow[]
    for (const row of rows) { this.setStatus(row.id, 'cancelled', now); this.event(row.id, 'cancelled', reason, now) }
  }
  assertContextCurrent(owner: string, refs: ContextReferences): void {
    for (const ref of refs.materials ?? []) this.ports.materials.get(owner, ref)
    for (const ref of refs.memories) {
      const memory = this.ports.memoryLibrary.get(owner, ref.id)
      if (memory.status !== 'active' || memory.revision !== ref.revision) throw new Error('参考记忆已被纠正或忘记，本轮不能继续提交。')
    }
  }
  invalidateMemory(owner: string, memoryId: string): string[] {
    return this.db.transaction(() => {
      const affected: string[] = []
      for (const run of this.db.prepare('SELECT * FROM runs WHERE character_id=?').all(owner) as RunRow[]) {
        const input = JSON.parse(run.input)
        if (!(input.contextReferences?.memories ?? input.memories ?? []).some((m: { id: string }) => m.id === memoryId)) continue
        this.db.prepare('INSERT OR IGNORE INTO execution_cleanup VALUES(?,?)').run(owner, run.id)
        affected.push(run.id)
        if (['queued', 'running', 'waiting', 'interrupted'].includes(run.status)) {
          this.setStatus(run.id, 'cancelled'); this.event(run.id, 'cancelled', '参考记忆已被纠正或忘记，本轮停止，已有成果保留。')
        }
        // Remove cached plaintext while retaining reference IDs for the work history.
        input.memories = []; this.db.prepare('UPDATE runs SET input=? WHERE id=?').run(JSON.stringify(input), run.id)
      }
      return affected
    })()
  }
  recordMaterialRead(runId: string, ref: import('../../../shared/contact-materials').MaterialReadRef): void {
    const run = this.assertLive(runId), input = JSON.parse(run.input)
    const chunk = this.ports.materials.read({ characterId: run.character_id, topicId: run.topic_id || undefined, query: '' }, ref, ref.start)
    if (!Number.isSafeInteger(ref.end) || ref.end < ref.start || ref.end > ref.start + chunk.text.length) throw new Error('资料引用范围无效。')
    ref = { id: ref.id, version: ref.version, start: ref.start, end: ref.end, ...(run.topic_id ? { topicId: run.topic_id } : {}) }
    input.contextReferences ??= { memories: [] }
    input.contextReferences.materials ??= []
    if (!input.contextReferences.materials.some((m: import('../../../shared/contact-materials').MaterialReadRef) => m.id === ref.id && m.version === ref.version && m.start === ref.start && m.end === ref.end)) input.contextReferences.materials.push(ref)
    this.db.prepare('UPDATE runs SET input=? WHERE id=?').run(JSON.stringify(input), runId)
  }
  recordMemoryContext(runId: string): void {
    const run = this.ports.getRun(runId)
    if (!run) throw new Error('工作记录不存在。')
    const input = JSON.parse(run.input)
    input.suppliedMemories = input.contextReferences?.memories ?? []
    this.db.prepare('UPDATE runs SET input=? WHERE id=?').run(JSON.stringify(input), runId)
  }
  invalidateMaterial(owner: string, materialId: string): string[] {
    return this.db.transaction(() => {
      const affected: string[] = []
      for (const run of this.db.prepare('SELECT * FROM runs WHERE character_id=?').all(owner) as RunRow[]) {
        if (!(JSON.parse(run.input).contextReferences?.materials ?? []).some((m: { id: string }) => m.id === materialId)) continue
        this.db.prepare('INSERT OR IGNORE INTO execution_cleanup VALUES(?,?)').run(owner, run.id)
        affected.push(run.id)
        if (['queued', 'running', 'waiting', 'interrupted'].includes(run.status)) {
          this.setStatus(run.id, 'cancelled'); this.event(run.id, 'cancelled', '参考资料已撤回，本轮停止，已有成果保留。')
        }
      }
      return affected
    })()
  }
  remove(id: string): string[] {
    return this.db.transaction(() => {
      const runs = (this.db.prepare('SELECT id FROM runs WHERE character_id=?').all(id) as { id: string }[]).map(r => r.id)
      for (const runId of runs) this.db.prepare('INSERT OR IGNORE INTO execution_cleanup VALUES(?,?)').run(id, runId)
      this.db.prepare('DELETE FROM profiles WHERE character_id=?').run(id)
      this.db.prepare('DELETE FROM token_ledger WHERE character_id=?').run(id)
      for (const runId of runs) this.db.prepare('DELETE FROM token_blocks WHERE run_id=?').run(runId)
      return runs
    })()
  }
  remember(id: string, text: string, runId: string | null = null): void {
    if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error('记忆内容应为 1–2000 字。')
    if (containsSecret(text)) throw new Error('请勿将密码、密钥等敏感凭据写入记忆。')
    this.ensure(id)
    this.ports.memoryLibrary.create(id, { content: text, kind: runId ? 'research' : 'preference', scope: { kind: 'contact' }, source: runId ? { kind: 'research', runId } : { kind: 'user', at: Date.now() } })
  }
  forget(id: string, memoryId: string): void { const memory = this.ports.memoryLibrary.get(id, memoryId); this.ports.memoryLibrary.forget(id, memoryId, memory.revision) }
  event(runId: string, kind: string, text: string, now = Date.now()): void { this.db.prepare('INSERT INTO events(run_id,kind,text,at) VALUES(?,?,?,?)').run(runId, kind, text.slice(0, 6000), now) }
  assignTopic(id: string, description: unknown, conversation: string, requestLog?: string, tokenLimit?: number): import("../../../shared/agents").AgentTopic {
    if (typeof description !== 'string' || !description.trim() || description.length > 2000 || containsSecret(description)) throw new Error('请描述需要联系人完成的任务（1–2000 字），不要包含密钥。')
    return this.db.transaction(() => {
      this.ensure(id)
      let settings = JSON.parse(this.ports.profile(id)!.settings) as AgentSettings
      if (!settings.goal) {
        settings = { ...settings, goal: '根据用户交付的任务整理方向、研究验证并反馈进展。', enabled: true }
        this.db.prepare('UPDATE profiles SET settings=?,revision=revision+1 WHERE character_id=?').run(JSON.stringify(settings), id)
      }
      validateAgentSettings(settings)
      const profile = this.ports.profile(id)!
      const hasCurrentWork = profile.focus_topic_id && this.db.prepare("SELECT 1 FROM runs WHERE topic_id=? AND status!='cancelled' LIMIT 1").get(profile.focus_topic_id)
      if (settings.enabled && hasCurrentWork && profile.focus_topic_id && canResearch(this.ports.topics.get(id, profile.focus_topic_id).status)) {
        this.db.prepare('INSERT OR IGNORE INTO task_schedule(topic_id,next_at) VALUES(?,?)').run(profile.focus_topic_id, profile.next_at)
      }
      let topic = this.ports.topics.create(id, { title: description.trim().slice(0, 80), goal: description.trim(), constraints: '' }, '用户交付任务，等待联系人整理方向。', Date.now(), requestLog)
      if (tokenLimit !== undefined) topic = this.ports.topics.tokenBudget(id, topic.id, topic.revision, tokenLimit)
      this.db.prepare('INSERT INTO task_schedule(topic_id,conversation,pending) VALUES(?,?,1)').run(topic.id, conversation.slice(-4000))
      if (!profile.focus_topic_id || !hasCurrentWork && !this.ports.scheduled(id).some(task => task.topic_id === profile.focus_topic_id)) this.db.prepare('UPDATE profiles SET focus_topic_id=? WHERE character_id=?').run(topic.id, id)
      // Accepting work is independent from being able to execute it today.
      if (this.ports.nextScheduledTopic(id) === topic.id) this.ports.startScheduledTopic(id, topic.id, conversation)
      return topic
    })()
  }
  assignCalendarTopic(id: string, raw: unknown, conversation: string, requestLog?: string): import("../../../shared/agents").AgentTopic {
    const input = validateRoutine(raw), rule = validateCalendarSchedule(input)
    return this.db.transaction(() => {
      this.ensure(id)
      const profile = this.ports.profile(id)!, settings = JSON.parse(profile.settings) as AgentSettings
      if (!settings.goal) this.db.prepare('UPDATE profiles SET settings=?,revision=revision+1 WHERE character_id=?')
        .run(JSON.stringify({ ...settings, goal: '根据用户交付的任务独立工作。', enabled: true }), id)
      let topic = this.ports.topics.create(id, { title: input.title, goal: input.instruction, constraints: '' }, '用户交付定时任务。', Date.now(), requestLog)
      topic = this.ports.topics.calendar(id, topic.id, topic.revision, rule)
      this.ports.calendars.save(topic.id, rule, Date.now())
      if (!input.enabled) topic = this.ports.topics.status(id, topic.id, topic.revision, 'paused', '用户暂停定时任务。')
      this.db.prepare('INSERT INTO task_schedule(topic_id,conversation,pending,next_at) VALUES(?,?,1,?)').run(topic.id, conversation.slice(-4000), this.ports.calendars.get(topic.id)!.next_at)
      const hasCurrentWork = profile.focus_topic_id && this.db.prepare("SELECT 1 FROM runs WHERE topic_id=? AND status!='cancelled' LIMIT 1").get(profile.focus_topic_id)
      if (!profile.focus_topic_id || !hasCurrentWork && !this.ports.scheduled(id).some(task => task.topic_id === profile.focus_topic_id)) this.db.prepare('UPDATE profiles SET focus_topic_id=? WHERE character_id=?').run(topic.id, id)
      return topic
    })()
  }
  editCalendarTopic(id: string, topicId: string, revision: number, raw: unknown, reason: string): AgentOverview {
    const input = validateRoutine(raw, 160), rule = validateCalendarSchedule(input)
    return this.db.transaction(() => {
      const previous = this.ports.topics.check(id, topicId, revision)
      this.changeTopic(id, topicId, revision, { input: { title: input.title, goal: input.instruction, constraints: previous.constraints }, reason,
        requestLog: appendTaskRequestLog(previous.requestLog, `用户：${reason}`) })
      let topic = this.ports.topics.get(id, topicId)
      topic = this.ports.topics.calendar(id, topicId, topic.revision, rule)
      this.ports.calendars.save(topicId, rule, Date.now())
      // Editing an ended task never revives it. Explicit continue remains a separate operation.
      if (!input.enabled && canResearch(topic.status)) this.ports.topics.status(id, topicId, topic.revision, 'paused', '用户暂停定时任务。')
      this.db.prepare('INSERT INTO task_schedule(topic_id,next_at) VALUES(?,?) ON CONFLICT(topic_id) DO UPDATE SET next_at=excluded.next_at').run(topicId, this.ports.calendars.get(topicId)!.next_at)
      return this.ports.overview(id)
    })()
  }
  saveBrief(runId: string, brief: { title: string; nextStep: string; question: string; plan: DeliveryPlan; resourceBudget?: TaskResourceBudget }): void {
    this.db.transaction(() => {
      const run = this.assertLive(runId), input = JSON.parse(run.input)
      if (input.brief) return
      const plan = validateDeliveryPlan(brief.plan)
      let topic: import('../../../shared/agents').AgentTopic = this.ports.topics.plan(run.character_id, run.topic_id!, run.topic_revision!, brief.title, brief.nextStep, runId, plan)
      this.db.prepare('UPDATE runs SET input=?,topic_revision=? WHERE id=?').run(JSON.stringify({ ...input, brief, topic, delivery: this.ports.deliveries.context(topic.id) }), topic.revision, runId)
      topic = this.ports.allocateTaskBudget(runId, brief.resourceBudget)
      this.event(runId, 'direction', `我准备先这样推进：${brief.nextStep}`)
      if (!brief.question) this.ports.notices.enqueue({ id: `${runId}:direction`, characterId: run.character_id, topicId: topic.id, runId,
        topicRevision: topic.revision, kind: 'progress', purpose: 'direction', createdAt: Date.now(), content: `收到「${topic.title}」，我开始处理。` })
    })()
  }
  saveBriefAnswer(runId: string, answer: string): void {
    this.db.transaction(() => {
      const run = this.assertLive(runId), input = JSON.parse(run.input)
      if (input.briefAnswer) return
      const before = this.ports.topics.get(run.character_id, run.topic_id!)
      const topic = this.ports.topics.edit(run.character_id, before.id, before.revision,
        { title: before.title, goal: before.goal, constraints: [before.constraints, answer].filter(Boolean).join('\n') },
        '用户补充任务方向。', appendTaskRequestLog(before.requestLog, `补充答复：${answer}`))
      this.db.prepare('UPDATE runs SET input=?,topic_revision=? WHERE id=?').run(JSON.stringify({ ...input, briefAnswer: answer, topic }), topic.revision, runId)
    })()
  }
  assertLive(runId: string): RunRow {
    const run = this.ports.getRun(runId)
    const profile = run && this.ports.profile(run.character_id)
    if (!run || !profile || run.revision !== profile.revision || !['running', 'queued', 'interrupted', 'waiting'].includes(run.status)) throw new Error('本轮工作已取消或角色已删除。')
    this.ports.handoffs.checkRun(runId)
    const refs = JSON.parse(run.input).contextReferences as ContextReferences | undefined
    if (refs) this.assertContextCurrent(run.character_id, refs)
    if (run.topic_id) {
      const topic = this.ports.topics.check(run.character_id, run.topic_id, run.topic_revision!)
      if (!canResearch(topic.status) && JSON.parse(run.input).revisionScope !== 'presentation') throw new Error('此事项已暂停或结束。')
    }
    return run
  }
  setStatus(id: string, status: AgentRunStatus, now = Date.now()): void {
    const previous = this.ports.getRun(id)?.status
    this.db.prepare('UPDATE runs SET status=?,updated_at=? WHERE id=?').run(status, now, id)
    if (status === 'running' && previous !== 'running') this.event(id, 'execution-start', '开始执行本轮工作。', now)
  }
  saveResearch(runId: string, research: AgentResearch): void {
    this.assertLive(runId)
    this.db.prepare('INSERT INTO research(run_id,value) VALUES(?,?) ON CONFLICT(run_id) DO UPDATE SET value=excluded.value').run(runId, JSON.stringify(research))
  }
  wait(id: string, question: string, inputs?: import('../../../shared/agent-delivery').TaskInputField[]): void {
    this.db.transaction(() => {
      const run = this.assertLive(id)
      this.db.prepare('UPDATE runs SET input=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(run.input), questionInputs: inputs }), id)
      this.db.prepare("UPDATE runs SET status='waiting',question=?,updated_at=? WHERE id=?").run(question, Date.now(), id)
      this.event(id, 'waiting', question)
      if (run.topic_id) {
        const topic = this.ports.topics.get(run.character_id, run.topic_id)
        this.ports.notices.enqueue({ id: `${id}:question:${createHash('sha256').update(question).digest('hex').slice(0, 16)}`, characterId: run.character_id, topicId: topic.id, runId: id,
          topicRevision: topic.revision, kind: 'question', createdAt: Date.now(), content: `关于「${topic.title}」：\n\n${question}` })
      }
    })()
  }
  answer(characterId: string, id: string, text: string, answers?: unknown): void {
    const { run } = this.ports.detail(characterId, id)
    if (run.status !== 'waiting') throw new Error('这项工作已不在等待回复。')
    if (typeof text !== 'string' || !text.trim() || text.length > 2000 || containsSecret(text)) throw new Error('请填写 1–2000 字的回复，不要包含密钥。')
    this.assertLive(id)
    const input = JSON.parse(this.ports.getRun(id)!.input)
    if (answers !== undefined) {
      const fields = input.questionInputs as import('../../../shared/agent-delivery').TaskInputField[] | undefined
      if (!fields?.length || !answers || typeof answers !== 'object' || Array.isArray(answers)) throw new Error('任务需求回复无效。')
      const values = answers as Record<string, unknown>
      if (Object.keys(values).some(key => !fields.some(field => field.id === key))) throw new Error('回复包含未知的需求项。')
      const supplied = fields.map(field => {
        const value = values[field.id]
        if (typeof value !== 'string' || value.length > 1000 || field.required && !value.trim() || containsSecret(value)) throw new Error('请填写有效的任务需求。')
        return { ...field, value: value.trim() }
      })
      const previous = (input.answeredInputs ?? []) as import('../../../shared/agent-delivery').TaskInputField[]
      input.answeredInputs = [...previous.filter(field => !supplied.some(answer => answer.id === field.id)), ...supplied]
    } else delete input.answeredInputs // A later free-text reply may supersede earlier form values.
    const needed = input.assignment && input.brief?.question && !input.briefAnswer && agentUsesPlanner(input.settings) ? 2 : 1
    if (run.topicId) this.ports.assertTaskBudget(characterId, run.topicId, needed)
    if (input.deliveryVersion === 1 && this.ports.callCount(characterId) + needed > JSON.parse(this.ports.profile(characterId)!.settings).dailyCalls) throw new Error('今日模型额度不足以处理回复，请明日再试或调整额度。')
    this.db.prepare("UPDATE runs SET status='queued',answer=?,updated_at=?,input=? WHERE id=?").run(text.trim(), Date.now(), JSON.stringify(input), id)
    this.event(id, 'answer', text.trim())
  }
  fail(id: string, error: string): void {
    this.db.transaction(() => this.failRun(id, error))()
  }
  failRun(id: string, error: string): void {
    const run = this.ports.getRun(id)
    if (!run || ['cancelled', 'completed', 'failed'].includes(run.status)) return
    const tokenBlock = this.db.prepare('SELECT message FROM token_blocks WHERE run_id=?').get(id) as { message: string } | undefined
    if (tokenBlock) {
      const message = tokenBlock.message || '工作 Token 额度不足，调整对应上限后继续。'
      const taskLimited = message.startsWith('本任务累计')
      let topicRevision = run.topic_revision!
      if (taskLimited && run.topic_id) {
        const topic = this.ports.topics.get(run.character_id, run.topic_id)
        topicRevision = this.ports.topics.status(run.character_id, topic.id, topic.revision, 'paused', message).revision
      }
      this.db.prepare('UPDATE runs SET status=?,error=?,updated_at=? WHERE id=?').run(taskLimited ? 'cancelled' : 'interrupted', message, Date.now(), id)
      this.event(id, 'token-limit', message)
      if (run.topic_id) this.ports.notices.enqueue({ id: `${id}:token-limit`, characterId: run.character_id, topicId: run.topic_id, runId: id,
        topicRevision, kind: 'progress', purpose: 'resources', createdAt: Date.now(), content: message })
      return
    }
    this.db.prepare("UPDATE runs SET status='failed',error=?,updated_at=? WHERE id=?").run(error.slice(0, 600), Date.now(), id)
    this.event(id, 'failed', error)
    if (JSON.parse(run.input).revisionScope === 'presentation') {
      if (run.topic_id) {
        const topic = this.ports.topics.get(run.character_id, run.topic_id)
        this.ports.notices.enqueue({ id: `${id}:presentation-failed`, purpose: 'presentation', characterId: run.character_id, topicId: topic.id, runId: id, topicRevision: topic.revision, kind: 'progress', createdAt: Date.now(), content: `「${topic.title}」的阅读样式修改未完成，原成果与正文已保留。${contactFailureReason(error)}\n可在这条消息的处理卡片中查看原因、打开对应设置或重试本次样式修改。` })
      }
      return
    }
    if (this.pauseForTaskBudget(id)) return
    const profile = this.ports.profile(run.character_id)!
    const settings = JSON.parse(profile.settings) as AgentSettings
    // Persist only this task's streak. Other tasks completing must not erase it.
    const failures = (this.ports.taskFailures.get(run.topic_id)?.failures ?? 0) + 1
    const nextAt = Date.now() + (providerRecoveryDelay(error, failures, settings.paceWriting ? settings.intervalMinutes : 0) ?? failureDelay(settings, failures))
    if (run.topic_id) this.ports.taskFailures.set(run.character_id, run.topic_id, run.id, failures, nextAt)
    this.db.prepare('UPDATE profiles SET next_at=? WHERE character_id=? AND focus_topic_id=?').run(nextAt, run.character_id, run.topic_id)
    this.db.prepare('UPDATE task_schedule SET next_at=? WHERE topic_id=?').run(nextAt, run.topic_id)
    if (run.topic_id) {
      const topic = this.ports.topics.get(run.character_id, run.topic_id)
      const providerDelay = settings.enabled ? providerRecoveryDelay(error, failures, settings.paceWriting ? settings.intervalMinutes : 0) : undefined
      const recovery = providerDelay !== undefined ? `服务暂时不可用，将在 ${providerDelay / 60000} 分钟后自动尝试继续；仍受工作时间和额度限制。` : failures >= 3 ? '已连续失败 3 次，自动推进已停止，请查看工作记录后重试。'
        : settings.enabled ? `将在 ${failureDelay(settings, failures) / 60000} 分钟后尝试继续；仍受工作时间和额度限制。` : '可在工作记录中重试。'
      this.ports.notices.enqueue({ id: `${id}:failure`, characterId: run.character_id, topicId: topic.id, runId: id, topicRevision: topic.revision,
        kind: 'progress', purpose: 'failure', createdAt: Date.now(), content: `关于「${topic.title}」：${contactFailureReason(error)}\n\n${recovery}\n可在这条消息的处理卡片中重试或打开对应设置；已有成果保留。` })
    }
  }
  createTopic(id: string, input: unknown): AgentOverview {
    this.ensure(id)
    return this.db.transaction(() => {
      const topic = this.ports.topics.create(id, input)
      if (!this.ports.profile(id)!.focus_topic_id) this.db.prepare('UPDATE profiles SET focus_topic_id=? WHERE character_id=?').run(topic.id, id)
      return this.ports.overview(id)
    })()
  }
  pauseForTaskBudget(runId: string): boolean {
    const run = this.ports.getRun(runId)
    if (!run?.topic_id) return false
    const topic = this.ports.topics.get(run.character_id, run.topic_id)
    if (!topic.resourceBudget || !canResearch(topic.status)) return false
    const settings = JSON.parse(this.ports.profile(run.character_id)!.settings) as AgentSettings
    const used = this.ports.taskCallCount(run.character_id, topic.id), needed = agentUsesPlanner(settings) ? 2 : 1
    if (used + needed <= topic.resourceBudget.modelCalls) return false
    const reason = `任务资源预算不足以继续下一轮：已用 ${used}/${topic.resourceBudget.modelCalls} 次，下一轮需 ${needed} 次。已有成果保留，请在本任务设置中调整预算后继续。`
    const next = this.ports.topics.status(run.character_id, topic.id, topic.revision, 'paused', reason)
    this.event(runId, 'resources-paused', reason)
    this.ports.notices.enqueue({ id: `${runId}:resources`, characterId: run.character_id, topicId: topic.id, runId, topicRevision: next.revision, kind: 'progress', purpose: 'resources', createdAt: Date.now(), content: `「${topic.title}」已暂停。${reason}` })
    return true
  }
  deleteTopic(id: string, topicId: string, revision: number): string[] {
    return this.db.transaction(() => {
      this.ports.topics.check(id, topicId, revision)
      const runs = this.db.prepare('SELECT id FROM runs WHERE character_id=? AND topic_id=?').all(id, topicId) as { id: string }[]
      for (const run of runs) this.db.prepare('INSERT OR IGNORE INTO execution_cleanup VALUES(?,?)').run(id, run.id)
      for (const memory of this.ports.memoryLibrary.list(id)) {
        if ((memory.scope.kind === 'task' && memory.scope.topicId === topicId) || (memory.source.kind === 'research' && runs.some(run => memory.source.kind === 'research' && run.id === memory.source.runId))) this.ports.memoryLibrary.forget(id, memory.id, memory.revision)
      }
      for (const run of runs) this.db.prepare('DELETE FROM token_blocks WHERE run_id=?').run(run.id)
      this.db.prepare("DELETE FROM notices WHERE character_id=? AND json_extract(value,'$.topicId')=?").run(id, topicId)
      this.db.prepare('DELETE FROM memories WHERE character_id=? AND run_id IN (SELECT id FROM runs WHERE character_id=? AND topic_id=?)').run(id, id, topicId)
      this.db.prepare('DELETE FROM runs WHERE character_id=? AND topic_id=?').run(id, topicId)
      this.db.prepare('DELETE FROM topics WHERE character_id=? AND id=?').run(id, topicId)
      this.ports.taskFailures.refresh(id)
      this.db.prepare('UPDATE profiles SET focus_topic_id=NULL WHERE character_id=? AND focus_topic_id=?').run(id, topicId)
      return runs.map(run => run.id)
    })()
  }
  revisePresentation(id: string, topicId: string, revision: number, feedback: unknown, conversation: string, baseVersion: number): string {
    if (typeof feedback !== 'string' || !feedback.trim() || feedback.length > 2000 || containsSecret(feedback)) throw new Error('请填写有效的样式修改意见。')
    return this.db.transaction(() => {
      this.ports.topics.check(id, topicId, revision)
      const artifact = this.ports.deliveries.get(topicId)
      if (!artifact || !Number.isSafeInteger(baseVersion) || artifact.version !== baseVersion) throw new Error('成果版本已变化或尚无正文，请重新读取。')
      if (this.ports.overview(id).runs.some(r => ['queued', 'running', 'waiting', 'interrupted'].includes(r.status) && r.topicId === topicId)) throw new Error('请先完成、回复或暂停当前工作，再修改样式。')
      const runId = this.ports.createRun(id, conversation, Date.now(), topicId, 'presentation')
      const input = JSON.parse(this.ports.getRun(runId)!.input)
      this.db.prepare('UPDATE runs SET input=? WHERE id=?').run(JSON.stringify({ ...input, revisionSectionId: undefined, revisionBaseVersion: baseVersion, feedback: feedback.trim() }), runId)
      this.event(runId, 'feedback', `仅修改阅读样式：${feedback.trim()}`)
      return runId
    })()
  }
  reviseCitation(id: string, revision: number, raw: ContentCitation, feedback: string, conversation: string): string {
    return this.db.transaction(() => {
      const citation = validateCitation(id, raw, this.ports.portfolio)
      if (this.ports.deliveries.get(citation.ref.topicId)?.version !== citation.ref.version) throw new Error('已有新版成果，请查看差异后重新选择修改依据。')
      const context = citationContext(id, [citation], this.ports.portfolio)
      const runId = this.reviseTopic(id, citation.ref.topicId, revision, feedback, conversation, citation.ref.sectionId)
      const input = { ...JSON.parse(this.ports.getRun(runId)!.input), revisionCitation: citation, citationContext: context }
      this.db.prepare('UPDATE runs SET input=? WHERE id=?').run(JSON.stringify(input), runId)
      return runId
    })()
  }
  reviseTopic(id: string, topicId: string, revision: number, feedback: unknown, conversation: string, sectionId?: string): string {
    if (typeof feedback !== 'string' || !feedback.trim() || feedback.length > 2000 || containsSecret(feedback)) throw new Error('请填写 1–2000 字的修改意见，不要包含密钥。')
    return this.db.transaction(() => {
      const topic = this.ports.topics.check(id, topicId, revision)
      if (sectionId !== undefined && !this.ports.deliveries.get(topicId)?.sections.some(s => s.id === sectionId)) throw new Error('找不到要修订的成果分节，请重新选择。')
      if (this.ports.overview(id).runs.some(r => ['queued', 'running', 'waiting', 'interrupted'].includes(r.status) && r.topicId === topicId)) throw new Error('请先完成、回复或暂停当前工作，再提交修改意见。')
      this.ports.topics.status(id, topicId, revision, 'planned', feedback.trim())
      const runId = this.ports.createRun(id, conversation, Date.now(), topicId)
      const input = JSON.parse(this.ports.getRun(runId)!.input)
      // Include earlier sections when explicitly revising; never replace the full artifact with a truncated copy.
      input.feedback = feedback.trim()
      input.revisionSectionId = sectionId
      input.topic = { ...input.topic, nextStep: `根据用户修改意见修订：${feedback.trim()}` }
      this.db.prepare('UPDATE runs SET input=? WHERE id=?').run(JSON.stringify(input), runId)
      this.event(runId, 'feedback', `用户对「${topic.title}」的修改意见：${feedback.trim()}`)
      return runId
    })()
  }
  editTaskFromChat(id: string, topicId: string, revision: number, patch: import('../../../shared/contact-task-edit').ContactTaskEdit, reason: string, archivedLog?: string): AgentOverview {
    return this.db.transaction(() => {
      const before = this.ports.topics.check(id, topicId, revision)
      if (!patch || !Object.keys(patch).length || Object.keys(patch).some(k => !['goal', 'constraints', 'title', 'modelCalls', 'tokens', 'separateEvaluations', 'clearTokenLimit'].includes(k))) throw new Error('任务修改字段无效。')
      if (patch.clearTokenLimit !== undefined && (patch.clearTokenLimit !== true || patch.tokens !== undefined)) throw new Error('解除任务Token上限不能同时设置新上限。')
      if (!reason?.trim() || reason.length > 2000) throw new Error('请保留有效的用户修改要求。')
      const requestLog = archivedLog ?? appendTaskRequestLog(before.requestLog, `用户：${reason.trim()}`)
      this.changeTopic(id, topicId, revision, { input: { title: patch.title ?? before.title, goal: patch.goal ?? before.goal, constraints: patch.constraints ?? before.constraints }, reason, requestLog })
      let topic = this.ports.topics.get(id, topicId)
      if (patch.separateEvaluations !== undefined) topic = this.ports.topics.evaluationDelivery(id, topicId, topic.revision, patch.separateEvaluations)
      if (patch.modelCalls !== undefined) topic = this.ports.setTaskBudget(id, topicId, topic.revision, { modelCalls: patch.modelCalls })
      if (patch.tokens !== undefined) {
        if (patch.tokens < (this.ports.tokens.usage(id).tasks[topicId] ?? 0)) throw new Error('上限不能低于本任务已占用的 Token 额度。')
        this.ports.topics.tokenBudget(id, topicId, topic.revision, patch.tokens)
      }
      if (patch.clearTokenLimit) this.ports.topics.tokenBudget(id, topicId, topic.revision, undefined)
      return this.ports.overview(id)
    })()
  }
  changeTopic(id: string, topicId: string, revision: number, change: { input: unknown; reason: string; requestLog?: string } | { status: AgentTopicStatus; reason: string }): AgentOverview {
    return this.db.transaction(() => {
      const topic = 'input' in change ? this.ports.topics.edit(id, topicId, revision, change.input, change.reason, change.requestLog) : this.ports.topics.status(id, topicId, revision, change.status, change.reason)
      const rows = this.db.prepare("SELECT id FROM runs WHERE character_id=? AND topic_id=? AND status IN ('queued','running','waiting','interrupted')").all(id, topicId) as { id: string }[]
      for (const row of rows) { this.setStatus(row.id, 'cancelled'); this.event(row.id, 'cancelled', `事项已调整：${topic.reason}`) }
      return this.ports.overview(id)
    })()
  }
  focusTopic(id: string, topicId: string): AgentOverview {
    const topic = this.ports.topics.get(id, topicId)
    if (!canResearch(topic.status)) throw new Error('请先恢复此事项，再设为当前事项。')
    this.db.prepare('UPDATE profiles SET focus_topic_id=? WHERE character_id=?').run(topicId, id)
    return this.ports.overview(id)
  }
  continueTopic(id: string, topicId: string, revision: number, reason: string, conversation: string): string | undefined {
    return this.db.transaction(() => {
      const topic = this.ports.topics.check(id, topicId, revision)
      if (topic.calendar && this.ports.calendars.get(topicId)?.finished_at) throw new Error('这次安排已经执行；请先修改为新的未来时间，再恢复。')
      this.ports.taskFailures.clear(id, topicId)
      const active = this.db.prepare("SELECT status FROM runs WHERE character_id=? AND status IN ('queued','running','waiting','interrupted') AND topic_id=?").get(id, topicId) as { status: string } | undefined
      if (active) throw new Error(active.status === 'waiting' ? '请先回答当前待确认的问题。' : '联系人已有一轮工作未完成。')
      this.ports.topics.status(id, topicId, revision, 'planned', reason)
      this.focusTopic(id, topicId)
      if (topic.calendar) return
      return this.ports.startScheduledTopic(id, topicId, conversation)
    })()
  }
}
