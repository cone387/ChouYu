import { assertTaskEnding, endingState } from '../../../shared/task-ending'
import { taskFeedbackSnapshot } from '../../agents/task-context'
import { ContactCalendars, type CalendarOccurrence } from '../../agents/calendar';
import { calendarScheduleLabel } from '../../../shared/calendar-schedule';
import { AgentMemories } from '../../agents/memories';
import { AgentHandoffs } from '../../agents/handoffs';
import { AgentTaskFailures } from '../../agents/task-failures';
import { ContactActions } from '../../agents/action-interactions';
import { AgentTokenBudget } from '../../agents/token-budget';
import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { AgentSettings, AgentReport } from '../../../shared/agents';
import { agentUsesPlanner, validateAgentSettings } from '../../../shared/agents';
import { AgentTopics, canResearch } from '../../agents/topics';
import { AgentDeliveries } from '../../agents/delivery';
import { withinWorkHours } from '../../../shared/work-settings';
import { RunRow, failureDelay } from './types';
import type { ContactStoreOperations } from './operations';
interface Ports {
  recoveryLimits?: import('../recovery').ContactStoreRecovery['limits']
  isRestoredRun?: import('../recovery').ContactStoreRecovery['oldRun']
  feedbackLedger: Pick<import('../../agents/feedback-ledger').FeedbackLedger, 'resume'>
  dependencies: Pick<import('../../agents/delivery-dependencies').DeliveryDependencies, 'pending'>
  profiles: ContactStoreOperations['profiles']
  topics: Pick<AgentTopics, "list" | "get" | "returnToGoal">
  taskFailures: Pick<AgentTaskFailures, "get" | "set" | "clear">
  getRun: ContactStoreOperations['getRun']
  heartbeatRows: Map<string, { id: number; topicId: string; at: number; }>
  profile: ContactStoreOperations['profile']
  callCount: ContactStoreOperations['callCount']
  scheduled: ContactStoreOperations['scheduled']
  assertTaskBudget: ContactStoreOperations['assertTaskBudget']
  memoryLibrary: Pick<AgentMemories, "select">
  deliveries: Pick<AgentDeliveries, "context">
  handoffs: Pick<AgentHandoffs, "bindRun" | "needsReview">
  event: ContactStoreOperations['event']
  tokens: Pick<AgentTokenBudget, "canResume">
  callsNeededToResume: ContactStoreOperations['callsNeededToResume']
  calendars: Pick<ContactCalendars, "get" | "claim" | "complete">
  providerRecovery: ContactStoreOperations['providerRecovery']
  taskCallCount: ContactStoreOperations['taskCallCount']
  assertLive: ContactStoreOperations['assertLive']
  research: ContactStoreOperations['research']
  saveResearch: ContactStoreOperations['saveResearch']
  pauseForTaskBudget: ContactStoreOperations['pauseForTaskBudget']
  fail: ContactStoreOperations['fail']
  actions: Pick<ContactActions, "recoverInterrupted">
  setStatus: ContactStoreOperations['setStatus']
}

export class ContactScheduling {
  constructor(private db: Database.Database, private ports: Ports) {}
  restoreFailureSchedules(): void {
    this.db.transaction(() => {
      for (const profile of this.ports.profiles()) {
        const settings = JSON.parse(profile.settings) as AgentSettings
        if (!settings.enabled || settings.paceWriting) continue
        for (const topic of this.ports.topics.list(profile.character_id)) {
          const failure = this.ports.taskFailures.get(topic.id)
          if (!failure || failure.failures >= 3 || !canResearch(topic.status)) continue
          const last = this.ports.getRun(failure.run_id)
          if (!last || last.status !== 'failed') continue
          const nextAt = Math.min(failure.next_at, last.updated_at + failureDelay(settings, failure.failures))
          this.ports.taskFailures.set(profile.character_id, topic.id, last.id, failure.failures, nextAt)
          this.db.prepare('UPDATE profiles SET next_at=min(next_at,?) WHERE character_id=? AND focus_topic_id=?').run(nextAt, profile.character_id, topic.id)
          this.db.prepare('UPDATE task_schedule SET next_at=min(next_at,?) WHERE topic_id=?').run(nextAt, topic.id)
        }
      }
    })()
  }
  recordHeartbeats(now = Date.now()): void {
    const seen = new Set<string>()
    for (const profile of this.ports.profiles()) {
      const settings = JSON.parse(profile.settings) as AgentSettings
      if (!settings.enabled || !profile.focus_topic_id) continue
      const topic = this.ports.topics.get(profile.character_id, profile.focus_topic_id)
      if (!canResearch(topic.status) || endingState(topic.ending, now).stopped) continue
      if (this.db.prepare("SELECT 1 FROM runs WHERE character_id=? AND status IN ('running','waiting','queued','interrupted')").get(profile.character_id)) continue
      seen.add(profile.character_id)
      const previous = this.ports.heartbeatRows.get(profile.character_id)
      const interveningRun = previous && this.db.prepare('SELECT 1 FROM runs WHERE character_id=? AND created_at>=? AND created_at<=?').get(profile.character_id, previous.at, now)
      if (previous && !interveningRun && previous.topicId === topic.id && now >= previous.at && now - previous.at <= 45000) {
        const updated = this.db.prepare('UPDATE activity_heartbeats SET ended_at=? WHERE id=?').run(now, previous.id)
        if (updated.changes) { previous.at = now; continue }
      }
      const row = this.db.prepare('INSERT INTO activity_heartbeats(topic_id,started_at,ended_at) VALUES(?,?,?)').run(topic.id, now, now)
      this.ports.heartbeatRows.set(profile.character_id, { id: Number(row.lastInsertRowid), topicId: topic.id, at: now })
    }
    for (const id of this.ports.heartbeatRows.keys()) if (!seen.has(id)) this.ports.heartbeatRows.delete(id)
  }
  createRun(id: string, context: string, now = Date.now(), topicId?: string, revisionScope?: 'presentation'): string {
    return this.db.transaction(() => {
      const profile = this.ports.profile(id)
      if (!profile) throw new Error('请先在聊天中交付任务。')
      const selected = topicId ?? profile.focus_topic_id
      if (selected) assertTaskEnding(this.ports.topics.get(id, selected).ending, now)
      const existing = this.db.prepare("SELECT * FROM runs WHERE character_id=? AND topic_id=? AND status IN ('queued','running','waiting','interrupted') LIMIT 1").get(id, selected) as RunRow | undefined
      if (existing) {
        return existing.id
      }
      if (!selected) throw new Error('请先选择一个要持续推进的事项。')
      const topic = this.ports.topics.get(id, selected)
      if (!canResearch(topic.status) && revisionScope !== 'presentation') throw new Error('当前事项已暂停或结束，请继续此事项或选择其他事项。')
      // Task goals replace the removed work-direction field, including legacy profiles.
      const settings = validateAgentSettings({ ...JSON.parse(profile.settings), goal: topic.goal })
      const recovery = this.ports.recoveryLimits?.(id, topic.id)
      if (recovery) settings.dailyCalls = recovery.dailyCalls
      if (this.ports.callCount(id, now) >= settings.dailyCalls) throw new Error('今日模型调用已达上限，明天再试或调整上限。')
      const scheduled = this.ports.scheduled(id).find(task => task.topic_id === topic.id)
      const assignment = Boolean(scheduled?.pending && revisionScope !== 'presentation')
      const needed = (revisionScope === 'presentation' ? 1 : agentUsesPlanner(settings) ? 2 : 1) + (assignment ? 1 : 0)
      if (this.ports.callCount(id, now) + needed > settings.dailyCalls) throw new Error(`联系人今日资源不足：已用 ${this.ports.callCount(id, now)}/${settings.dailyCalls} 次，本轮需预留 ${needed} 次（规划与执行）。可等明日恢复或调整联系人资源上限。`)
      this.ports.assertTaskBudget(id, topic.id, needed)
      const runId = randomUUID()
      const selectedMemories = this.ports.memoryLibrary.select({ characterId: id, topicId: topic.id, query: `${topic.goal}\n${context}` })
      const previous = (this.db.prepare('SELECT reports.value FROM reports JOIN runs ON runs.id=reports.run_id WHERE runs.topic_id=? AND runs.character_id=? ORDER BY reports.rowid DESC LIMIT 3').all(topic.id, id) as { value: string }[]).map(row => JSON.parse(row.value) as AgentReport)
      const baselineRun = this.db.prepare('SELECT topic_revision FROM runs WHERE id=?').get(previous[0]?.runId ?? '') as { topic_revision: number } | undefined
      const candidate = this.db.prepare('SELECT * FROM runs WHERE character_id=? AND topic_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(id, topic.id) as RunRow | undefined
      const last = candidate && !this.ports.isRestoredRun?.(id, candidate.id) ? candidate : undefined
      const feedback = last?.status === 'failed' && JSON.parse(last.input).revisionScope !== 'presentation' ? [JSON.parse(last.input).feedback, last.answer ? `对问题「${last.question}」的回复：${last.answer}` : ''].filter(Boolean).join('\n').slice(0, 4000) : undefined
      const input = JSON.stringify({ revisionScope, revisionSectionId: last?.status === 'failed' ? JSON.parse(last.input).revisionSectionId : undefined, deliveryVersion: 1, delivery: this.ports.deliveries.context(topic.id), feedback, researchVersion: 1, baseline: previous[0] && !feedback ? { evidence: previous[0].evidence.map(e => ({ url: e.url, hash: e.hash })), topicRevision: (baselineRun?.topic_revision ?? -1) + 1 } : undefined, settings, topic, memories: selectedMemories.items, contextReferences: { memories: selectedMemories.items.map(m => ({ id: m.id, revision: m.revision })) }, memoriesTruncated: selectedMemories.truncated, previous: previous.map(r => ({ title: r.title, body: r.body.slice(0, 2000), nextStep: r.nextStep })), conversation: context.slice(-4000) })
      const withContext = { ...JSON.parse(input), taskContext: taskFeedbackSnapshot(this.db, id, topic.id) }
      const runInput = JSON.stringify(assignment ? { ...withContext, assignment: true, conversation: scheduled!.conversation || context.slice(-4000) } : withContext)
      this.db.prepare('INSERT INTO runs(id,character_id,revision,status,created_at,updated_at,input,topic_id,topic_revision) VALUES(?,?,?,\'queued\',?,?,?,?,?)').run(runId, id, profile.revision, now, now, runInput, topic.id, topic.revision)
      this.ports.handoffs.bindRun(runId)
      if (assignment) this.db.prepare("UPDATE task_schedule SET pending=0,conversation='' WHERE topic_id=?").run(topic.id)
      if (revisionScope !== 'presentation' && (settings.maxConcurrentTasks ?? 1) > 1) this.db.prepare('INSERT OR IGNORE INTO task_schedule(topic_id) VALUES(?)').run(topic.id)
      this.db.prepare('UPDATE profiles SET next_at=? WHERE character_id=? AND focus_topic_id=?').run(now + settings.intervalMinutes * 60000, id, topic.id)
      this.db.prepare('UPDATE task_schedule SET next_at=? WHERE topic_id=?').run(now + settings.intervalMinutes * 60000, topic.id)
      this.ports.event(runId, 'queued', `已安排事项「${topic.title}」的本轮工作。`, now)
      return runId
    })()
  }
  nextScheduledTopic(id: string, now = Date.now(), newSources?: (topicId: string) => boolean, excluded: ReadonlySet<string> = new Set()): string | undefined {
    const profile = this.ports.profile(id)
    if (!profile) return
    const settings = JSON.parse(profile.settings) as AgentSettings
    const restored = this.ports.recoveryLimits?.(id)
    if (restored) settings.dailyCalls = restored.dailyCalls
    if (settings.enabled && !withinWorkHours(settings, now)) return
    const unfinished = this.db.prepare("SELECT * FROM runs WHERE character_id=? AND status IN ('queued','running','waiting','interrupted')").all(id) as RunRow[]
    const runnable = unfinished.filter(run => (!run.topic_id || !endingState(this.ports.topics.get(id, run.topic_id).ending, now).stopped) && ( run.status === 'running' || run.status !== 'waiting' &&
      this.ports.tokens.canResume(run.id, id, run.topic_id, now) && this.ports.callCount(id, now) + this.ports.callsNeededToResume(run.id) <= settings.dailyCalls))
    if (runnable.length >= (settings.maxConcurrentTasks ?? 1)) return
    const busy = new Set(unfinished.map(run => run.topic_id))
    const tasks = this.ports.scheduled(id)
    if (profile.focus_topic_id && !tasks.some(task => task.topic_id === profile.focus_topic_id))
      tasks.unshift({ topic_id: profile.focus_topic_id, pending: 0, next_at: profile.next_at, conversation: '' })
    // Accept queued assignments first, then the oldest due round; continuous work cannot starve peers.
    tasks.sort((a, b) => b.pending - a.pending || a.next_at - b.next_at)
    for (const candidate of tasks) {
      if (busy.has(candidate.topic_id) || excluded.has(candidate.topic_id) || !candidate.pending && !settings.enabled) continue
      const topic = this.ports.topics.get(id, candidate.topic_id)
      if (!canResearch(topic.status) || endingState(topic.ending, now).stopped) continue
      const calendar = topic.calendar && this.ports.calendars.get(topic.id)
      if (topic.calendar && (!settings.enabled || !calendar || calendar.finished_at || calendar.next_at > now)) continue
      if (!this.ports.handoffs.needsReview(id, topic.id)) continue
      const failure = this.ports.taskFailures.get(topic.id)
      const recovery = failure && failure.failures >= 3 ? this.ports.providerRecovery(id, topic.id) : undefined
      if (failure && (failure.failures >= 3 && !recovery || Math.max(failure.next_at, recovery?.at ?? 0) > now)) continue
      const sourceChanged = () => this.ports.dependencies.pending(id).some(update => update.topicId === candidate.topic_id) || Boolean(newSources?.(candidate.topic_id))
      if (!calendar && candidate.next_at > now && !(settings.enabled && !settings.paceWriting && !failure && sourceChanged())) continue
      const needed = (agentUsesPlanner(settings) ? 2 : 1) + (candidate.pending ? 1 : 0)
      if (this.ports.callCount(id, now) + needed > settings.dailyCalls) continue
      const taskLimit = this.ports.recoveryLimits?.(id, topic.id)?.taskCalls ?? topic.resourceBudget?.modelCalls
      if (taskLimit !== undefined && this.ports.taskCallCount(id, topic.id) + needed > taskLimit) continue
      return candidate.topic_id
    }
  }
  startScheduledTopic(id: string, topicId: string, conversation: string): string {
    return this.db.transaction(() => {
      const active = this.db.prepare("SELECT id FROM runs WHERE topic_id=? AND status IN ('queued','running','waiting','interrupted')").get(topicId) as { id: string } | undefined
      if (active) { this.ports.topics.get(id, topicId); return active.id }
      const topic = this.ports.topics.get(id, topicId)
      const occurrence = topic.calendar ? this.ports.calendars.claim(topicId, topic.calendar, Date.now()) : undefined
      const previous = this.db.prepare('SELECT id FROM runs WHERE character_id=? AND topic_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(id, topicId) as { id: string } | undefined
      const runId = this.createRun(id, conversation, Date.now(), topicId)
      if (previous) this.ports.feedbackLedger.resume(previous.id, runId)
      if (occurrence) {
        this.db.prepare("UPDATE runs SET input=json_set(input,'$.calendar',json(?)) WHERE id=?").run(JSON.stringify(occurrence), runId)
        this.ports.event(runId, 'calendar', `计划时间：${new Date(occurrence.dueAt).toLocaleString()}；实际启动：${new Date().toLocaleString()}。${calendarScheduleLabel(occurrence.rule)}`)
      }
      this.db.prepare('UPDATE profiles SET focus_topic_id=? WHERE character_id=?').run(topicId, id)
      return runId
    })()
  }
  defer(runId: string, reason: string, unchanged = false): void {
    this.db.transaction(() => {
      const run = this.ports.assertLive(runId), settings = JSON.parse(this.ports.profile(run.character_id)!.settings) as AgentSettings
      const research = this.ports.research(runId)
      const streak = run.topic_id ? ((this.db.prepare('SELECT streak FROM research_idle WHERE topic_id=?').get(run.topic_id) as { streak: number } | undefined)?.streak ?? 0) : 0
      const delay = Math.min(10080, Math.max(settings.intervalMinutes, research?.plan.checkAfterMinutes ?? 0) * (unchanged ? 2 ** Math.min(streak + 1, 3) : 1))
      const nextAt = Date.now() + delay * 60000
      if (run.topic_id && unchanged) this.db.prepare('INSERT INTO research_idle VALUES(?,?) ON CONFLICT(topic_id) DO UPDATE SET streak=excluded.streak').run(run.topic_id, streak + 1)
      if (research) this.ports.saveResearch(runId, { ...research, unchanged, nextCheckAt: nextAt })
      this.ports.taskFailures.clear(run.character_id, run.topic_id)
      this.db.prepare('UPDATE profiles SET next_at=? WHERE character_id=? AND focus_topic_id=?').run(nextAt, run.character_id, run.topic_id)
      this.db.prepare('UPDATE task_schedule SET next_at=? WHERE topic_id=?').run(nextAt, run.topic_id)
      this.db.prepare("UPDATE runs SET status='completed',summary=?,updated_at=? WHERE id=?").run(reason, Date.now(), runId)
      const calendarNext = this.completeCalendar(run)
      this.ports.event(runId, 'deferred', `${reason}\n本轮未生成新报告；${calendarNext === undefined ? `下次检查：${new Date(nextAt).toISOString()}` : '已记录本期检查。'}`)
      this.ports.pauseForTaskBudget(runId)
    })()
  }
  recoverOutOfScopeQuestion(runId: string, error: string): void {
    this.db.transaction(() => {
      const run = this.ports.assertLive(runId)
      const input = JSON.parse(run.input)
      if (input.questionBoundary?.decision?.blocking !== false || !run.topic_id) throw new Error('尚未确认追问偏离任务，不能自动撤回。')
      const topic = this.ports.topics.get(run.character_id, run.topic_id)
      this.ports.fail(runId, `非必要追问已撤回，但本轮纠正未完成：${error.slice(0, 300)}。将按原任务重试，不需要批准额外行动。`)
      this.ports.topics.returnToGoal(run.character_id, topic.id, this.ports.topics.get(run.character_id, topic.id).revision, runId)
      this.db.prepare("UPDATE runs SET input=json_set(input,'$.questionBoundaryRequested',0,'$.questionBoundaryVersion',2) WHERE id=?").run(runId)
      this.ports.event(runId, 'question-replan', '已撤回非必要追问，保留失败与原始成果，下一轮重新执行原任务；未填写用户答复。')
    })()
  }
  recover(): void {
    this.ports.actions.recoverInterrupted()
    // Recheck legacy continuous-task interruptions once, without fabricating a user reply.
    for (const run of this.db.prepare("SELECT * FROM runs WHERE status='waiting'").all() as RunRow[]) {
      const input = JSON.parse(run.input), settings = JSON.parse(this.ports.profile(run.character_id)!.settings) as AgentSettings
      if (!settings.enabled || settings.paceWriting || (input.questionBoundaryVersion >= 2 || input.questionBoundary?.decision?.blocking === true) || input.assignment || !this.ports.research(run.id) || input.deliveryVersion !== 1) continue
      this.db.prepare("UPDATE runs SET input=json_set(input,'$.questionBoundaryRequested',1,'$.questionBoundaryVersion',2) WHERE id=?").run(run.id)
    }
    const rows = this.db.prepare("SELECT id FROM runs WHERE status='running'").all() as { id: string }[]
    for (const row of rows) { this.ports.setStatus(row.id, 'interrupted'); this.ports.event(row.id, 'interrupted', '执行进程已重启，将从持久化检查点恢复；未完成的只读步骤可能重试。') }
  }
  completeCalendar(run: RunRow): number | undefined {
    if (!run.topic_id) return
    const occurrence = JSON.parse(run.input).calendar as CalendarOccurrence | undefined
    const nextAt = this.ports.calendars.complete(run.topic_id, occurrence, Date.now())
    if (nextAt !== undefined) {
      this.db.prepare('UPDATE task_schedule SET next_at=? WHERE topic_id=?').run(nextAt, run.topic_id)
      this.db.prepare('UPDATE profiles SET next_at=? WHERE character_id=? AND focus_topic_id=?').run(nextAt, run.character_id, run.topic_id)
    }
    return nextAt
  }
}
