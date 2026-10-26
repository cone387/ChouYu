import { safeAgentFailure } from '../agents/failure'
import { SkillRunner } from '../skills/runner'
import type { SkillSnapshot } from '../../shared/skills'
import { ContactTaskStore } from '../task-center/contact-store'
import { WorkStrategyRuntime, type AgentModel } from './workflow'
import type { AgentSettings } from '../../shared/agents'
import { withinWorkHours } from '../../shared/work-settings'

import type { ContactModule, ContactModuleOwner, ContactIdentity } from '../contact-agent/contracts'
import { RunScheduler } from '../agent-space/scheduler'
import { createWorkModel } from './model'
import type { HarnessRegistry } from '../harness/registry'
import type { ContactRequest } from '../../shared/contact-commands'
export class WorkLoop implements ContactModule {
  readonly id = 'workloop'
  private closed = false
  private closing?: Promise<void>
  constructor(private owner: ContactModuleOwner, private store: ContactTaskStore, private runtime: WorkStrategyRuntime,
    private scheduler: RunScheduler, private skillRunner: SkillRunner, private changed: (id: string) => void,
    private wake: () => void, private request: ContactRequest,
    private modelFactory: ((identity: ContactIdentity) => AgentModel) | undefined, private readSkills: ((id: string) => SkillSnapshot) | undefined,
    private harnesses: HarnessRegistry, private recoveryBudget?: import('../agent-space/recovery-port').RecoveryBudgetPort) {}
  private identity(id: string) {
    if (id !== this.owner.id) throw new Error('工作模块不能访问其他联系人身份。')
    return this.owner.identity
  }
  prepare() {
    if (this.closed) return
    if (this.store.recovery.identity(this.owner.id) && !this.store.recovery.identity(this.owner.id)!.scopeReviewed) return
    const ownProfile = this.store.profile(this.owner.id)
    if (!ownProfile) return
    for (const profile of [ownProfile]) {
      const settings = JSON.parse(profile.settings) as AgentSettings
      if (this.scheduler.activeFor(profile.character_id).length >= (settings.maxConcurrentTasks ?? 1)) continue
      if (settings.searchEnabled && !this.owner.identity?.searchKey) continue
      if (!this.owner.identity?.config) continue
      this.store.decisions.checkScheduledResources(profile.character_id)
      const considered = new Set(this.scheduler.activeFor(profile.character_id).map(run => run.topicId).filter((id): id is string => id !== null))
      for (const topic of this.store.topics.list(profile.character_id)) if (!this.store.recovery.allowed(profile.character_id, topic.id)) considered.add(topic.id)
      while (true) {
        const topicId = this.store.nextScheduledTopic(profile.character_id, Date.now(), topicId => {
          if (!settings.readContactDeliveries) return false
          const last = this.store.overview(profile.character_id).runs.find(run => run.topicId === topicId)
          const research = last && this.store.research(last.id)
          if (last?.status !== 'completed' || research?.contactQuery === undefined) return false
          const catalog = this.runtime.contactSources.discover(profile.character_id, topicId, research.contactQuery)
          return catalog.items.some(item => !item.processed)
        }, considered)
        if (!topicId) break
        considered.add(topicId)
        const last = this.store.overview(profile.character_id).runs.find(run => run.topicId === topicId)
        const research = last && this.store.research(last.id)
        if (!this.store.handoffs.forTopic(profile.character_id, topicId) && !this.store.topics.get(profile.character_id, topicId).calendar && last?.status === 'completed' && research?.contactQuery !== undefined && settings.readContactDeliveries) {
          const catalog = this.runtime.contactSources.discover(profile.character_id, topicId, research.contactQuery)
          if (catalog.total > 0 && catalog.unprocessedTotal === 0) {
            this.store.db.prepare('UPDATE profiles SET next_at=? WHERE character_id=? AND focus_topic_id=?').run(Date.now() + settings.intervalMinutes * 60000, profile.character_id, topicId)
            this.store.db.prepare('UPDATE task_schedule SET next_at=? WHERE topic_id=?').run(Date.now() + settings.intervalMinutes * 60000, topicId)
            continue
          }
        }
        try { this.store.startScheduledTopic(profile.character_id, topicId, this.identity(profile.character_id).conversation); this.changed(profile.character_id) } catch { /* invalid profiles remain visible, without a hot retry loop */ }
      }
    }
  }
  advance() {
    if (this.closed) return false
    for (const run of this.store.runnable()) {
      if (run.character_id !== this.owner.id || this.scheduler.get(run.id)) continue
      if (this.store.recovery.oldRun(run.character_id, run.id) || !this.store.recovery.allowed(run.character_id, run.topic_id)) continue
      if (!this.owner.identity?.config || JSON.parse(run.input).revisionScope !== 'presentation' && JSON.parse(run.input).settings.searchEnabled && !this.owner.identity?.searchKey) continue
      const settings = JSON.parse(this.store.profile(run.character_id)!.settings) as AgentSettings
      const active = this.scheduler.activeFor(run.character_id)
      if (JSON.parse(run.input).calendar && (!settings.enabled || !withinWorkHours(settings))) continue
      if (active.length >= (settings.maxConcurrentTasks ?? 1) || active.some(current => current.topicId === run.topic_id)) continue
      if (run.status === 'waiting' && (!settings.enabled || settings.paceWriting || !withinWorkHours(settings))) continue
      if (!this.scheduler.canStart({ id: run.id, characterId: run.character_id, topicId: run.topic_id }, settings.maxConcurrentTasks ?? 1)) continue
      if (!this.store.tokens.canResume(run.id, run.character_id, run.topic_id)) continue
      if (!this.store.reserveRunCalls(run.id)) continue
      try { if (this.startRun(run, settings.maxConcurrentTasks ?? 1)) return true }
      catch (error) { this.store.releaseRunCalls(run.id); this.store.fail(run.id, safeAgentFailure(error)); this.changed(run.character_id) }
    }
    return false
  }
  private startRun(run: NonNullable<ReturnType<ContactTaskStore['getRun']>>, limit: number) {
    try { this.store.handoffs.bindRun(run.id) } catch (error) { this.store.fail(run.id, error instanceof Error ? error.message : '交接来源无法读取。'); this.changed(run.character_id); this.store.releaseRunCalls(run.id); return false }
    run = this.store.getRun(run.id)!
    if (run.topic_id && JSON.parse(run.input).revisionScope !== 'presentation') this.store.db.prepare('UPDATE profiles SET focus_topic_id=? WHERE character_id=?').run(run.topic_id, run.character_id)
    const identity = structuredClone(this.identity(run.character_id))
    const input = JSON.parse(run.input)
    if (!Object.hasOwn(input, 'backgroundHarnessEngine')) {
      input.backgroundHarnessEngine = identity.backgroundHarnessEngine ?? 'native'
      this.store.db.prepare('UPDATE runs SET input=? WHERE id=?').run(JSON.stringify(input), run.id)
    }
    if (!input.materialDirectory) {
      input.materialDirectory = this.store.materials.list({ characterId: run.character_id, topicId: run.topic_id || undefined, query: '' })
      this.store.db.prepare('UPDATE runs SET input=? WHERE id=?').run(JSON.stringify(input), run.id)
    }
    // Persist once; resumed checkpoints never acquire a different skill configuration.
    if (!Object.hasOwn(input, 'skills')) {
      const priorCall = this.store.db.prepare('SELECT 1 FROM calls WHERE run_id=? LIMIT 1').get(run.id)
      try { input.skills = priorCall ? { entries: [], instruction: '' } : this.readSkills?.(identity.id) ?? identity.skills ?? { entries: [], instruction: '' } }
      catch (error) { input.skills = { entries: [], instruction: '', error: error instanceof Error ? error.message : '技能读取失败。' } }
      this.store.db.prepare('UPDATE runs SET input=? WHERE id=?').run(JSON.stringify(input), run.id)
    }
    const model = createWorkModel({ store: this.store, identity, run, input, skillRunner: this.skillRunner,
      modelFactory: this.modelFactory, changed: this.changed, request: this.request, harnesses: this.harnesses, recoveryBudget: this.recoveryBudget })
    return this.scheduler.launch({ id: run.id, characterId: run.character_id, topicId: run.topic_id }, limit, async signal => {
      try { signal.throwIfAborted(); await this.runtime.execute(run.id, identity.soul, model, signal, () => this.changed(run.character_id), identity.searchKey) }
      catch (error) {
        await this.runtime.storage.controlOperation(() => {
          if (this.closed) { if (this.store.getRun(run.id)?.status === 'running') this.store.setStatus(run.id, 'interrupted') }
          else this.store.fail(run.id, signal.aborted ? '本轮已停止，可检查设置后重新运行。' : safeAgentFailure(error))
        })
      } finally { await this.runtime.storage.controlOperation(() => { this.store.releaseRunCalls(run.id); this.changed(run.character_id); this.wake() }) }
    })
  }
  close(): Promise<void> {
    if (this.closing) return this.closing
    this.closed = true
    this.skillRunner.cancel(this.owner.id)
    this.scheduler.abort(this.owner.id)
    this.closing = this.scheduler.drain(this.owner.id)
    return this.closing
  }
}
