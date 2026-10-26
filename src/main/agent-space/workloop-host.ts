import { validateContactCommand, type ContactCommandName, type ContactArgs, type ContactResult, type EmptyContactCommand } from '../../shared/contact-commands'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { ContactTaskStore } from '../task-center/contact-store'
import { ContactTaskCommands } from '../task-center/commands'
import { WorkStrategyRuntime, type AgentModel } from '../workloop/workflow'
import { WorkLoop } from '../workloop/loop'
import { ContactAgent } from '../contact-agent/agent'
import { ModuleRegistry } from '../contact-agent/registry'
import type { ContactIdentity } from '../contact-agent/contracts'
import { SkillLibrary } from '../skills/library'
import { SkillRunner } from '../skills/runner'
import type { SkillSnapshot } from '../../shared/skills'
import type { AgentSearcher } from '../agents/research'
import { safeAgentFailure } from '../agents/failure'
import { RunScheduler } from './scheduler'
import { ContactEvents } from './events'
import { createBackgroundHarnesses } from '../harness/background'
import type { HarnessRegistry } from '../harness/registry'
import type { DshRuntimeOptions } from '../harness/dsh/runtime'
import { ContactStorageBarrier, StorageBoundaryTimeout } from './storage-barrier'
import { ContactBackups } from '../storage/contact-backups'
import type { ContactBackupStatus } from '../../shared/contact-backups'

export type { ContactIdentity } from '../contact-agent/contracts'
export interface WorkLoopHostOptions { capacity?: number; modules?: readonly string[]; harnesses?: HarnessRegistry; dshRuntime?: DshRuntimeOptions; recoveryBudget?: import('./recovery-port').RecoveryBudgetPort }
const signature = (identity: ContactIdentity) => createHash('sha256').update(JSON.stringify({ soul: identity.soul,
  config: identity.config, searchKey: identity.searchKey, skillToolsEnabled: identity.skillToolsEnabled,
  disabledSkillTools: identity.disabledSkillTools })).digest('hex')

/** Shared worker execution host; application contact composition lives in AgentSpace. */
export class WorkLoopHost {
  readonly store: ContactTaskStore
  readonly runtime: WorkStrategyRuntime
  readonly storage = new ContactStorageBarrier()
  readonly backups: ContactBackups
  private backupStatus: ContactBackupStatus = { phase: 'idle', failures: 0 }
  private backupTask?: Promise<void>
  private backupChanges = ''
  private backupTimer: ReturnType<typeof setInterval>
  private firstBackupTimer?: ReturnType<typeof setTimeout>
  private readonly skillRunner: SkillRunner
  private readonly scheduler: RunScheduler
  private readonly events = new ContactEvents()
  private readonly modules = new ModuleRegistry()
  private readonly harnesses: HarnessRegistry
  private readonly contacts = new Map<string, ContactAgent>()
  private readonly subscriptions = new Map<string, () => void>()
  private readonly commands: ContactTaskCommands
  private readonly faults = new Map<string, string>()
  private readonly cleaning = new Map<string, Promise<void>>()
  private readonly cleanupFaults = new Map<string, { characterId: string; error: string }>()
  private nextCleanupAt = 0
  private readonly deleting = new Set<string>()
  private ready = false
  private recoveredContacts = new Set<string>()
  private closed = false
  private ticking = false
  private closing?: Promise<void>
  private lastStarted?: string
  private eventLoop = monitorEventLoopDelay({ resolution: 20 })
  private timer: ReturnType<typeof setInterval>
  private wakeTimer?: ReturnType<typeof setTimeout>
  constructor(directory: string, private changed: (id: string) => void,
    modelFactory?: (identity: ContactIdentity) => AgentModel, reader?: ConstructorParameters<typeof WorkStrategyRuntime>[2],
    searcher?: AgentSearcher, readSkills?: (id: string) => SkillSnapshot, skillDirectory = join(directory, 'skills'),
    private options: WorkLoopHostOptions = {}) {
    this.scheduler = new RunScheduler(options.capacity ?? 8, (error, run) => this.faults.set(run.characterId, safeAgentFailure(error)))
    this.harnesses = options.harnesses ?? createBackgroundHarnesses(options.dshRuntime)
    mkdirSync(directory, { recursive: true })
    this.skillRunner = new SkillRunner(new SkillLibrary(skillDirectory))
    this.store = new ContactTaskStore(join(directory, 'agents.db'))
    let runtime: WorkStrategyRuntime | undefined
    try {
      this.runtime = runtime = new WorkStrategyRuntime(this.store, join(directory, 'checkpoints.db'), reader, searcher, this.storage)
      this.backups = new ContactBackups(directory, { tasks: this.store.db, checkpoints: this.runtime.checkpointDatabase },
        operation => this.storage.snapshot(async () => {
          this.backupStatus.phase = 'saving'
          const revision = this.storageRevision()
          const result = await operation()
          this.backupChanges = revision
          return result
        }))
      this.backupStatus.lastSuccessAt = this.backups.list()[0]?.createdAt
      this.commands = new ContactTaskCommands({ store: this.store, identity: id => this.identity(id),
        changed: id => this.notify(id), tick: () => this.tick(), remove: id => this.remove(id),
        activeFor: (id, topicId) => this.scheduler.activeFor(id, topicId), abort: (id, topicId) => this.scheduler.abort(id, topicId),
        activeRun: id => this.scheduler.get(id), cleanupThread: id => this.cleanupThread(id) })
      this.modules.register('workloop', owner => new WorkLoop(owner, this.store, this.runtime, this.scheduler,
        this.skillRunner, id => this.notify(id), () => this.wake(), (method, id, args) => this.request(method, id, args), modelFactory, readSkills, this.harnesses, options.recoveryBudget))
      this.modules.resolve(options.modules ?? ['workloop'])
      this.store.recover()
      this.eventLoop.enable()
      this.timer = setInterval(() => this.tick(), 15000)
      this.backupTimer = setInterval(() => { void this.backupNow() }, 300000)
    } catch (error) {
      try { runtime?.close() } finally { this.store.close() }
      throw error
    }
  }
  private assertOpen() { if (this.closed) throw new Error('联系人空间已关闭。') }
  admitCommand(method: string, work: () => Promise<unknown>): Promise<unknown> {
    return ['pause', 'remove', 'detachModule', 'deleteTopic', 'topicStatus'].includes(method)
      ? this.storage.controlOperation(work) : this.storage.operation(work)
  }
  private identity(id: string) {
    const contact = this.contacts.get(id)
    if (!contact || this.deleting.has(id)) throw new Error('联系人不存在。')
    return contact.identity
  }
  private notify(id: string) {
    this.changed(id); if (!this.closed) this.events.publish(id)
    if (!this.closed && !this.backupStatus.lastSuccessAt && !this.backupStatus.lastAttemptAt && !this.firstBackupTimer) {
      this.firstBackupTimer = setTimeout(() => {
        this.firstBackupTimer = undefined
        // Do not put the initial burst of user requests behind a just-started model call.
        // Idle notification/close retries this first snapshot; the periodic timer still uses the bounded drain.
        if (!this.scheduler.size) void this.backupNow()
      }, 0)
    }
  }
  backupNow(): Promise<void> {
    if (this.backupTask) return this.backupTask
    if (!this.store.db.prepare('SELECT 1 FROM runs LIMIT 1').get() && !this.store.db.prepare('SELECT 1 FROM topics LIMIT 1').get()) return Promise.resolve()
    if (this.storageRevision() === this.backupChanges) return Promise.resolve()
    this.backupStatus = { ...this.backupStatus, phase: 'waiting', lastAttemptAt: Date.now(), reason: undefined }
    this.backupTask = this.storage.detached(async () => {
      try {
        const group = await this.backups.create()
        this.backupStatus = { phase: 'idle', failures: 0, lastAttemptAt: this.backupStatus.lastAttemptAt, lastSuccessAt: group.createdAt }
      } catch (error) {
        this.backupStatus = { ...this.backupStatus, phase: 'failed', failures: this.backupStatus.failures + 1, reason: error instanceof StorageBoundaryTimeout ? 'busy' : 'storage' }
      }
    }).finally(() => { this.backupTask = undefined; this.wake() })
    return this.backupTask
  }
  private storageRevision() {
    return [this.store.db, this.runtime.checkpointDatabase].map(db => (db.prepare('SELECT total_changes() AS count').get() as { count: number }).count).join(':')
  }
  private wake() {
    if (this.closed || this.wakeTimer) return
    this.wakeTimer = setTimeout(() => { this.wakeTimer = undefined; this.tick() }, 0)
  }
  async sync(identities: ContactIdentity[], enqueue: (id: string, operation: () => Promise<void>) => Promise<void> = (_id, operation) => operation(), queuedOwners: string[] = []) {
    this.assertOpen()
    if (identities.some(identity => !identity.id) || new Set(identities.map(identity => identity.id)).size !== identities.length) throw new Error('联系人身份重复或无效。')
    const liveIds = new Set(identities.map(identity => identity.id))
    this.store.recovery.setRoster([...liveIds])
    await this.storage.operation(() => { for (const identity of identities) this.store.recovery.sync(identity.id, identity.recovery) })
    const knownIds = new Set([...this.store.profiles().map(profile => profile.character_id), ...queuedOwners])
    const removed = [...knownIds].filter(id => !liveIds.has(id))
    await Promise.all([
      ...identities.map(identity => enqueue(identity.id, () => this.syncContact(identity))),
      ...removed.map(id => enqueue(id, () => this.remove(id)))
    ])
    await this.recoverCleanup()
  }
  syncContact(identity: ContactIdentity): Promise<void> {
    return this.storage.operation(() => this.syncContactAdmitted(identity))
  }
  private syncContactAdmitted(identity: ContactIdentity) {
    this.assertOpen()
    if (!identity?.id || this.deleting.has(identity.id)) throw new Error('联系人身份无效或正在删除。')
    this.store.recovery.sync(identity.id, identity.recovery)
    let contact = this.contacts.get(identity.id)
    if (contact && signature(contact.identity) !== signature(identity)) {
      this.scheduler.abort(identity.id)
      this.store.cancel(identity.id, '角色人设或模型配置已变化，请重新发起工作。')
      this.notify(identity.id)
    }
    if (contact) contact.update(identity)
    else {
      contact = new ContactAgent(identity, this.modules)
      contact.mount((this.options.modules ?? ['workloop']).filter(id => id !== 'workloop' || identity.workLoopEnabled !== false))
      this.contacts.set(identity.id, contact)
      this.subscriptions.set(identity.id, this.events.subscribe(identity.id, () => this.wake()))
    }
    this.store.ensure(identity.id)
    this.store.actions.reconcile(identity.id, identity.configurationVersions ?? {})
    this.store.memoryLibrary.registerSessions(identity.id, identity.sessionIds ?? [])
    this.runtime.contactSources.names.set(identity.id, identity.name || identity.id)
    if (!this.recoveredContacts.has(identity.id) && !identity.recovery) {
      this.store.decisions.publishOutstanding(identity.id, new Set(identity.visibleNoticeIds ?? []))
      this.recoveredContacts.add(identity.id)
    }
    this.ready = true
    this.wake()
  }
  async remove(id: string) {
    return this.storage.controlOperation(() => this.removeAdmitted(id))
  }
  private async removeAdmitted(id: string) {
    this.assertOpen()
    this.deleting.add(id)
    this.subscriptions.get(id)?.(); this.subscriptions.delete(id)
    try {
      this.store.cancel(id, '联系人已删除。')
      this.scheduler.abort(id); this.skillRunner.cancel(id)
      await this.contacts.get(id)?.close()
      await this.scheduler.drain(id)
      await Promise.all(this.harnesses.all().map(module => module.lifecycle?.purge?.({ characterId: id })))
      for (const runId of this.store.remove(id)) await this.cleanupThread(runId)
      this.contacts.delete(id); this.faults.delete(id)
      this.runtime.contactSources.names.delete(id); this.recoveredContacts.delete(id)
    } finally { this.deleting.delete(id) }
  }
  async detachModule(id: string, moduleId: string) {
    return this.storage.controlOperation(() => this.detachAdmitted(id, moduleId))
  }
  private async detachAdmitted(id: string, moduleId: string) {
    this.assertOpen(); this.identity(id)
    await this.contacts.get(id)!.detach(moduleId)
    this.notify(id)
  }
  private cleanupThread(runId: string): Promise<void> {
    const existing = this.cleaning.get(runId)
    if (existing) return existing
    const intent = this.store.pendingCleanup().find(item => item.requestId === runId)
    if (!intent) return Promise.resolve()
    const work = this.storage.operation(async () => {
      try {
        await this.scheduler.get(runId)?.promise
        await Promise.all(this.harnesses.all().map(module => module.lifecycle?.purge?.({ characterId: intent.characterId, requestIds: [runId] })))
        await this.runtime.checkpoints.getTuple({ configurable: { thread_id: runId } })
        await this.runtime.checkpoints.deleteThread(runId)
        this.store.finishCleanup(intent.characterId, runId)
        this.cleanupFaults.delete(runId)
      } catch (error) {
        this.cleanupFaults.set(runId, { characterId: intent.characterId, error: safeAgentFailure(error) })
        throw error
      }
    }).finally(() => this.cleaning.delete(runId))
    this.cleaning.set(runId, work)
    return work
  }
  private async recoverCleanup() {
    try {
      await Promise.allSettled(this.store.pendingCleanup().map(intent => this.cleanupThread(intent.requestId)))
      this.cleanupFaults.delete('cleanup-storage')
    } catch (error) {
      this.cleanupFaults.set('cleanup-storage', { characterId: '', error: safeAgentFailure(error) })
    }
  }
  request<M extends EmptyContactCommand>(method: M, id: string): Promise<ContactResult<M>>
  request<M extends ContactCommandName>(method: M, id: string, args: ContactArgs<M>): Promise<ContactResult<M>>
  async request(method: ContactCommandName, id: string, args: unknown[] = []): Promise<unknown> {
    return this.dispatchUnknown(method, id, args)
  }
  async dispatchUnknown(rawMethod: unknown, owner: unknown, rawArgs: unknown = []): Promise<unknown> {
    const operation = () => this.dispatchAdmitted(rawMethod, owner, rawArgs)
    return ['remove', 'detachModule', 'pause'].includes(String(rawMethod)) ? this.storage.controlOperation(operation) : this.storage.operation(operation)
  }
  private async dispatchAdmitted(rawMethod: unknown, owner: unknown, rawArgs: unknown): Promise<unknown> {
    validateContactCommand(rawMethod, owner, rawArgs)
    const method = rawMethod, id = owner as string, args = rawArgs as unknown[]
    this.assertOpen()
    const recovery = this.store.recovery.identity(id)
    if (recovery) {
      if (method === 'notices') return this.store.notices.pending(id).filter(notice => !this.store.recovery.original(id).notices.includes(notice.id))
      if (method === 'actionNotices') return this.store.actions.notices(id).filter(card => !this.store.recovery.original(id).interactions.includes(card.id))
      const historical = new Set(['get', 'dashboard', 'spaceDiagnostics', 'detail', 'topicDetail', 'delivery', 'portfolio', 'analytics', 'summary', 'interactions', 'pendingInteractions', 'getInteraction', 'materialList', 'readMaterial', 'readContactFile', 'materialHistory', 'materialInventory', 'memoryList', 'memoryHistory', 'handoffs', 'handoffState', 'fileList', 'contactHome', 'outputPreferences', 'pause', 'remove', 'detachModule', 'deleteTopic', 'withdrawMaterial', 'forgetMemory', 'forget', 'savePreferences', 'save', 'editTopic', 'setOutputPreference'])
      if (!historical.has(method) && !recovery.scopeReviewed) throw new Error('备份恢复后需要核对资料、权限与未知用量，暂不执行新工作。')
      const oldInteraction = ['submitInteraction', 'claimAction', 'startActionExecution', 'acknowledgeAction', 'finishAction'].includes(method)
        && this.store.recovery.original(id).interactions.includes(String(args[0]))
      const oldAnswer = method === 'answer' && this.store.recovery.oldRun(id, String(args[0]))
        || method === 'answerChecked' && this.store.recovery.oldRun(id, String(args[2]))
      if (oldInteraction || oldAnswer || ['continueTopic', 'reviseTopic'].includes(method)) throw new Error('恢复前的尝试和交互不能重放，请在原任务中核对后开始新的尝试。')
      if (method === 'run') {
        const topicId = typeof args[0] === 'string' ? args[0] : this.store.overview(id).focusTopicId
        if (!topicId || !this.store.recovery.allowed(id, topicId)) throw new Error('此任务尚未完成恢复核对。')
        this.store.createRun(id, this.identity(id).conversation, Date.now(), topicId)
        this.notify(id); this.tick(); return this.store.overview(id)
      }
      if (method === 'resumeRecovered') {
        const [topicId, restoreId, requestId] = args.map(String)
        this.store.recovery.start(id, topicId, restoreId, requestId, () => this.store.createRun(id, this.identity(id).conversation, Date.now(), topicId))
        this.notify(id); this.tick(); return this.store.overview(id)
      }
    }
    if (method === 'attachModule') {
      this.identity(id)
      const contact = this.contacts.get(id)!, moduleId = String(args[0])
      if (!contact.module(moduleId)) contact.mount([moduleId])
      this.notify(id)
      return null
    }
    if (method === 'detachModule') {
      if (this.contacts.has(id)) await this.detachModule(id, String(args[0]))
      return null
    }
    if (method === 'spaceDiagnostics') {
      const pending = this.store.db.prepare(`SELECT count(*) AS count, min(created_at) AS oldest FROM (
        SELECT json_extract(value,'$.createdAt') AS created_at FROM notices WHERE state='pending'
        UNION ALL SELECT json_extract(value,'$.createdAt') FROM contact_interactions
        WHERE json_extract(value,'$.kind')='action' AND COALESCE(json_extract(value,'$.delivered'),0)=0
      )`).get() as { count: number; oldest: number | null }
      return { activeRuns: this.scheduler.size, capacity: this.scheduler.capacity,
        metrics: { observedAt: Date.now(), activeRuns: this.scheduler.size, capacity: this.scheduler.capacity, pendingDeliveries: pending.count, backup: { ...this.backupStatus },
          ...(pending.oldest !== null ? { oldestPendingAt: pending.oldest } : {}),
          ...(Number.isFinite(this.eventLoop.mean) ? { eventLoopDelayMs: this.eventLoop.mean / 1e6 } : {}) },
        faults: [...this.faults].map(([characterId, error]) => ({ characterId, error })).concat([...this.cleanupFaults.values()]) }
    }
    return this.commands.dispatchUnknown(method, id, args)
  }
  tick() {
    if (!this.ready || this.closed || this.ticking || this.storage.blocked) return
    void this.storage.operation(() => this.tickAdmitted()).catch(error => this.faults.set('', safeAgentFailure(error)))
  }
  private tickAdmitted() {
    if (Date.now() >= this.nextCleanupAt) { this.nextCleanupAt = Date.now() + 15000; void this.recoverCleanup() }
    this.ticking = true
    try {
      this.store.recordHeartbeats()
      const contacts = [...this.contacts.values()].filter(contact => !this.deleting.has(contact.id))
      const failed = new Set<string>()
      for (const contact of contacts) {
        try { contact.prepare(); this.faults.delete(contact.id) }
        catch (error) { this.faults.set(contact.id, safeAgentFailure(error)); failed.add(contact.id) }
      }
      let started: boolean
      do {
        started = false
        const start = (contacts.findIndex(contact => contact.id === this.lastStarted) + 1) % (contacts.length || 1)
        for (let n = 0; n < contacts.length && this.scheduler.size < this.scheduler.capacity; n++) {
          const contact = contacts[(start + n) % contacts.length]
          if (failed.has(contact.id)) continue
          try { if (contact.advance()) { started = true; this.lastStarted = contact.id } }
          catch (error) { this.faults.set(contact.id, safeAgentFailure(error)); failed.add(contact.id) }
        }
      } while (started && this.scheduler.size < this.scheduler.capacity)
    } finally { this.ticking = false }
  }
  close(): Promise<void> {
    if (this.closing) return this.closing
    this.closed = true; clearInterval(this.timer); clearTimeout(this.wakeTimer); clearInterval(this.backupTimer); clearTimeout(this.firstBackupTimer)
    this.eventLoop.disable()
    this.events.clear(); this.subscriptions.clear(); this.skillRunner.cancel()
    this.closing = Promise.all([...this.contacts.values()].map(contact => contact.close())).then(async () => {
      await this.scheduler.drain()
      await Promise.allSettled([...this.cleaning.values()])
      await Promise.all(this.harnesses.all().map(module => module.lifecycle?.close?.()))
      await this.backupTask
      await this.backupNow()
      this.runtime.close(); this.store.close(); this.contacts.clear()
    })
    return this.closing
  }
}
