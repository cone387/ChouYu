import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
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

export type { ContactIdentity } from '../contact-agent/contracts'
export interface WorkLoopHostOptions { capacity?: number; modules?: readonly string[]; harnesses?: HarnessRegistry; dshRuntime?: DshRuntimeOptions }
const signature = (identity: ContactIdentity) => createHash('sha256').update(JSON.stringify({ soul: identity.soul,
  config: identity.config, searchKey: identity.searchKey, skillToolsEnabled: identity.skillToolsEnabled,
  disabledSkillTools: identity.disabledSkillTools })).digest('hex')

/** Shared worker execution host; application contact composition lives in AgentSpace. */
export class WorkLoopHost {
  readonly store: ContactTaskStore
  readonly runtime: WorkStrategyRuntime
  private readonly skillRunner: SkillRunner
  private readonly scheduler: RunScheduler
  private readonly events = new ContactEvents()
  private readonly modules = new ModuleRegistry()
  private readonly harnesses: HarnessRegistry
  private readonly contacts = new Map<string, ContactAgent>()
  private readonly subscriptions = new Map<string, () => void>()
  private readonly commands: ContactTaskCommands
  private readonly faults = new Map<string, string>()
  private readonly deleting = new Set<string>()
  private ready = false
  private recoveredContacts = new Set<string>()
  private closed = false
  private ticking = false
  private closing?: Promise<void>
  private lastStarted?: string
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
    this.runtime = new WorkStrategyRuntime(this.store, join(directory, 'checkpoints.db'), reader, searcher)
    this.commands = new ContactTaskCommands({ store: this.store, identity: id => this.identity(id),
      changed: id => this.notify(id), tick: () => this.tick(), remove: id => this.remove(id),
      activeFor: (id, topicId) => this.scheduler.activeFor(id, topicId), abort: (id, topicId) => this.scheduler.abort(id, topicId),
      activeRun: id => this.scheduler.get(id), cleanupThread: id => this.cleanupThread(id) })
    this.modules.register('workloop', owner => new WorkLoop(owner, this.store, this.runtime, this.scheduler,
      this.skillRunner, id => this.notify(id), () => this.wake(), (method, id, args) => this.request(method, id, args), modelFactory, readSkills, this.harnesses))
    this.modules.resolve(options.modules ?? ['workloop'])
    this.store.recover()
    this.timer = setInterval(() => this.tick(), 15000)
  }
  private assertOpen() { if (this.closed) throw new Error('联系人空间已关闭。') }
  private identity(id: string) {
    const contact = this.contacts.get(id)
    if (!contact || this.deleting.has(id)) throw new Error('联系人不存在。')
    return contact.identity
  }
  private notify(id: string) { this.changed(id); if (!this.closed) this.events.publish(id) }
  private wake() {
    if (this.closed || this.wakeTimer) return
    this.wakeTimer = setTimeout(() => { this.wakeTimer = undefined; this.tick() }, 0)
  }
  async sync(identities: ContactIdentity[], enqueue: (id: string, operation: () => Promise<void>) => Promise<void> = (_id, operation) => operation(), queuedOwners: string[] = []) {
    this.assertOpen()
    if (identities.some(identity => !identity.id) || new Set(identities.map(identity => identity.id)).size !== identities.length) throw new Error('联系人身份重复或无效。')
    const liveIds = new Set(identities.map(identity => identity.id))
    const knownIds = new Set([...this.store.profiles().map(profile => profile.character_id), ...queuedOwners])
    const removed = [...knownIds].filter(id => !liveIds.has(id))
    await Promise.all([
      ...identities.map(identity => enqueue(identity.id, async () => { this.syncContact(identity) })),
      ...removed.map(id => enqueue(id, () => this.remove(id)))
    ])
  }
  syncContact(identity: ContactIdentity) {
    this.assertOpen()
    if (!identity?.id || this.deleting.has(identity.id)) throw new Error('联系人身份无效或正在删除。')
    let contact = this.contacts.get(identity.id)
    if (contact && signature(contact.identity) !== signature(identity)) {
      this.scheduler.abort(identity.id)
      this.store.cancel(identity.id, '角色人设或模型配置已变化，请重新发起工作。')
      this.notify(identity.id)
    }
    if (contact) contact.update(identity)
    else {
      contact = new ContactAgent(identity, this.modules)
      contact.mount(this.options.modules ?? ['workloop'])
      this.contacts.set(identity.id, contact)
      this.subscriptions.set(identity.id, this.events.subscribe(identity.id, () => this.wake()))
    }
    this.store.ensure(identity.id)
    this.store.actions.reconcile(identity.id, identity.configurationVersions ?? {})
    this.store.memoryLibrary.registerSessions(identity.id, identity.sessionIds ?? [])
    this.runtime.contactSources.names.set(identity.id, identity.name || identity.id)
    if (!this.recoveredContacts.has(identity.id)) {
      this.store.decisions.publishOutstanding(identity.id, new Set(identity.visibleNoticeIds ?? []))
      this.recoveredContacts.add(identity.id)
    }
    this.ready = true
    this.wake()
  }
  async remove(id: string) {
    this.assertOpen()
    this.deleting.add(id)
    this.subscriptions.get(id)?.(); this.subscriptions.delete(id)
    try {
      this.store.cancel(id, '联系人已删除。')
      this.scheduler.abort(id); this.skillRunner.cancel(id)
      await this.contacts.get(id)?.close()
      await this.scheduler.drain(id)
      for (const runId of this.store.remove(id)) await this.cleanupThread(runId)
      this.contacts.delete(id); this.faults.delete(id)
      this.runtime.contactSources.names.delete(id); this.recoveredContacts.delete(id)
    } finally { this.deleting.delete(id) }
  }
  async detachModule(id: string, moduleId: string) {
    this.assertOpen(); this.identity(id)
    await this.contacts.get(id)!.detach(moduleId)
    this.notify(id)
  }
  private async cleanupThread(runId: string) {
    try {
      await this.runtime.checkpoints.getTuple({ configurable: { thread_id: runId } })
      await this.runtime.checkpoints.deleteThread(runId)
    } catch { /* A run can fail before checkpoint tables exist. */ }
  }
  async request(method: string, id: string, args: unknown[] = []): Promise<any> {
    this.assertOpen()
    if (method === 'attachModule') {
      this.identity(id)
      this.contacts.get(id)!.mount([String(args[0])])
      this.notify(id)
      return null
    }
    if (method === 'detachModule') {
      if (this.contacts.has(id)) await this.detachModule(id, String(args[0]))
      return null
    }
    if (method === 'spaceDiagnostics') return { activeRuns: this.scheduler.size, capacity: this.scheduler.capacity, faults: [...this.faults].map(([characterId, error]) => ({ characterId, error })) }
    return this.commands.request(method, id, args)
  }
  tick() {
    if (!this.ready || this.closed || this.ticking) return
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
    this.closed = true; clearInterval(this.timer); clearTimeout(this.wakeTimer)
    this.events.clear(); this.subscriptions.clear(); this.skillRunner.cancel()
    this.closing = Promise.all([...this.contacts.values()].map(contact => contact.close())).then(async () => {
      await this.scheduler.drain()
      await Promise.all(this.harnesses.all().map(module => module.lifecycle?.close?.()))
      this.runtime.close(); this.store.close(); this.contacts.clear()
    })
    return this.closing
  }
}
