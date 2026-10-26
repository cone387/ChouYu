import { assertTaskEnding } from '../../../shared/task-ending'
import type Database from 'better-sqlite3';
import type { AgentSettings, AgentTopicStatus } from '../../../shared/agents';
import { validateTaskResourceBudget, type TaskResourceBudget } from '../../../shared/agent-resources';
import { AgentTopics } from '../../agents/topics';
import { type DeliveryPlan } from '../../../shared/agent-delivery';
import type { AIResponseMetadata } from '../../../shared/ai-usage';
import { dayStart } from './types';
import type { ContactStoreOperations } from './operations';
interface Ports {
  recoveryLimits?: import('../recovery').ContactStoreRecovery['limits']
  getRun: ContactStoreOperations['getRun']
  profile: ContactStoreOperations['profile']
  callsNeededToResume: ContactStoreOperations['callsNeededToResume']
  topics: Pick<AgentTopics, "list" | "get" | "check" | "budget">
  assertLive: ContactStoreOperations['assertLive']
  event: ContactStoreOperations['event']
}

export class ContactCallBudget {
  private callReservations = new Map<string, { owner: string; topicId: string | null; callsAtStart: number; needed: number }>()
  constructor(private db: Database.Database, private ports: Ports) {}
  callCount(id: string, now = Date.now()): number { return (this.db.prepare('SELECT count(*) AS n FROM calls WHERE character_id=? AND at>=?').get(id, dayStart(now)) as { n: number }).n }
  runCalls(runId: string): number { return (this.db.prepare('SELECT COUNT(*) AS n FROM calls WHERE run_id=?').get(runId) as { n: number }).n }
  reservedCalls(owner: string, exceptTopicId?: string | null): number {
    let reserved = 0
    for (const [runId, claim] of this.callReservations) {
      if (claim.owner !== owner || exceptTopicId !== undefined && claim.topicId === exceptTopicId) continue
      const run = this.ports.getRun(runId)
      if (!run || ['cancelled', 'completed', 'failed'].includes(run.status)) continue
      reserved += Math.max(0, claim.needed - Math.max(0, this.runCalls(runId) - claim.callsAtStart))
    }
    return reserved
  }
  reserveRunCalls(runId: string): boolean {
    const run = this.ports.getRun(runId)!, settings = JSON.parse(this.ports.profile(run.character_id)!.settings) as AgentSettings
    const needed = this.ports.callsNeededToResume(runId)
    if (this.callCount(run.character_id) + this.reservedCalls(run.character_id) + needed > (this.ports.recoveryLimits?.(run.character_id, run.topic_id)?.dailyCalls ?? settings.dailyCalls)) return false
    this.callReservations.set(runId, { owner: run.character_id, topicId: run.topic_id, callsAtStart: this.runCalls(runId), needed })
    return true
  }
  releaseRunCalls(runId: string): void { this.callReservations.delete(runId) }
  taskCallCount(id: string, topicId: string): number {
    return (this.db.prepare('SELECT count(*) AS n FROM calls c JOIN runs r ON r.id=c.run_id WHERE c.character_id=? AND r.topic_id=?').get(id, topicId) as { n: number }).n
  }
  resourceContext(id: string, topicId: string, now = Date.now()): { contactDailyLimit: number; dailyRemaining: number; taskUsed: number; taskBudget: TaskResourceBudget | undefined; allocatableCalls: number; otherTasks: { title: string; remaining: number; }[]; } {
    const settings = JSON.parse(this.ports.profile(id)!.settings) as AgentSettings
    const recovery = this.ports.recoveryLimits?.(id, topicId)
    if (recovery) settings.dailyCalls = recovery.dailyCalls
    const topics = this.ports.topics.list(id)
    const allocations = topics.filter(t => t.id !== topicId && t.resourceBudget && !['completed', 'abandoned'].includes(t.status))
      .map(t => ({ title: t.title, remaining: Math.max(0, t.resourceBudget!.modelCalls - this.taskCallCount(id, t.id)) }))
    const dailyRemaining = Math.max(0, settings.dailyCalls - this.callCount(id, now) - this.reservedCalls(id, topicId))
    return { contactDailyLimit: settings.dailyCalls, dailyRemaining, taskUsed: this.taskCallCount(id, topicId),
      taskBudget: recovery ? { modelCalls: recovery.taskCalls, reason: '恢复后新增授权；历史用量仍不完整。' } : topics.find(t => t.id === topicId)?.resourceBudget,
      // Automatic initial budgets stay within one configured day's allowance;
      // lifetime budgets never reserve today's execution capacity.
      allocatableCalls: Math.max(0, Math.min(10000, settings.dailyCalls) - this.taskCallCount(id, topicId)), otherTasks: allocations }
  }
  assertTaskBudget(id: string, topicId: string, needed: number): void {
    const topic = this.ports.topics.get(id, topicId)
    const limit = this.ports.recoveryLimits?.(id, topicId)?.taskCalls ?? topic.resourceBudget?.modelCalls
    if (limit === undefined) return
    const used = this.taskCallCount(id, topicId)
    if (used + needed > limit) throw new Error(`本任务调用预算不足：可核对已用 ${used}/${limit} 次，本轮需预留 ${needed} 次。已有成果保留，请核对本任务额度。`)
  }
  setTaskBudget(id: string, topicId: string, revision: number, raw: unknown): { resourceBudget: TaskResourceBudget; revision: number; updatedAt: number; reason: string; calendar?: import("../../../shared/calendar-schedule").CalendarSchedule; separateEvaluations?: boolean; tokenLimit?: number; initialPlan?: import("../../../shared/agent-delivery").DeliveryPlan; requestLog?: string; id: string; characterId: string; status: AgentTopicStatus; judgement: string; openQuestions: string; nextStep: string; createdAt: number; title: string; goal: string; constraints: string; } {
    return this.db.transaction(() => {
      this.ports.topics.check(id, topicId, revision)
      if (this.db.prepare("SELECT 1 FROM runs WHERE topic_id=? AND status IN ('queued','running','waiting','interrupted')").get(topicId)) throw new Error('请先暂停本任务，再调整资源预算。')
      const budget = validateTaskResourceBudget({ modelCalls: (raw as Partial<TaskResourceBudget> | null)?.modelCalls, reason: '用户手动调整任务预算。' }), resources = this.resourceContext(id, topicId)
      if (budget.modelCalls < resources.taskUsed) throw new Error(`预算不能低于已使用的 ${resources.taskUsed} 次调用。`)
      return this.ports.topics.budget(id, topicId, revision, budget)
    })()
  }
  allocateTaskBudget(runId: string, raw?: TaskResourceBudget): import("../../../shared/agents").AgentTopic {
    return this.db.transaction(() => {
      const run = this.ports.assertLive(runId), topic = this.ports.topics.get(run.character_id, run.topic_id!)
      if (topic.resourceBudget) return topic
      if (!raw) return topic
      const resources = this.resourceContext(run.character_id, topic.id)
      const requested = validateTaskResourceBudget(raw)
      const modelCalls = Math.max(resources.taskUsed, Math.min(requested.modelCalls, resources.taskUsed + resources.allocatableCalls))
      const budget = { modelCalls: Math.max(1, modelCalls), reason: requested.reason.slice(0, 950) + (modelCalls < requested.modelCalls ? '（已按联系人可分配额度收紧。）' : '') }
      const next = this.ports.topics.budget(run.character_id, topic.id, topic.revision, budget, runId)
      const input = JSON.parse(run.input)
      this.db.prepare('UPDATE runs SET input=?,topic_revision=? WHERE id=?').run(JSON.stringify({ ...input, topic: next }), next.revision, runId)
      this.ports.event(runId, 'resources', `任务累计调用预算：${budget.modelCalls} 次；已用 ${resources.taskUsed} 次。${budget.reason}`)
      return next
    })()
  }
  charge(runId: string, now = Date.now()): void {
    this.db.transaction(() => {
      const run = this.ports.assertLive(runId), settings = JSON.parse(this.ports.profile(run.character_id)!.settings) as AgentSettings
    if (run.topic_id) assertTaskEnding(this.ports.topics.get(run.character_id, run.topic_id).ending, now)
      if (this.callCount(run.character_id, now) + this.reservedCalls(run.character_id, run.topic_id) >= (this.ports.recoveryLimits?.(run.character_id, run.topic_id)?.dailyCalls ?? settings.dailyCalls)) throw new Error('今日模型调用已达上限（含其他执行任务的预留）。')
      if (run.topic_id) this.assertTaskBudget(run.character_id, run.topic_id, 1)
      this.db.prepare('INSERT INTO calls(character_id,run_id,at) VALUES(?,?,?)').run(run.character_id, runId, now)
    })()
  }
  searchCount(id: string, now = Date.now()): number { return (this.db.prepare('SELECT count(*) AS n FROM search_calls WHERE character_id=? AND at>=?').get(id, dayStart(now)) as { n: number }).n }
  chargeSearch(runId: string, now = Date.now()): void {
    this.db.transaction(() => {
      const run = this.ports.assertLive(runId), settings = JSON.parse(this.ports.profile(run.character_id)!.settings) as AgentSettings
    if (run.topic_id) assertTaskEnding(this.ports.topics.get(run.character_id, run.topic_id).ending, now)
      if (!settings.searchEnabled || this.searchCount(run.character_id, now) >= (settings.dailySearches ?? 8)) throw new Error('搜索未开启或今日搜索已达上限。')
      this.db.prepare('INSERT INTO search_calls(character_id,run_id,at) VALUES(?,?,?)').run(run.character_id, runId, now)
    })()
  }
  recordCallMetadata(callId: number, metadata: AIResponseMetadata, now = Date.now()): void {
    this.db.prepare('UPDATE calls SET metadata=? WHERE id=?').run(JSON.stringify({ ...metadata, recordedAt: now }), callId)
  }
}
