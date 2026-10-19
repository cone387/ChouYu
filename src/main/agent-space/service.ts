import { ContactAgent } from '../contact-agent/agent'
import { ContactChat } from '../contact-agent/chat'
import { ContactWorkLoop, type WorkLoopTransport } from '../contact-agent/workloop'
import { ModuleRegistry } from '../contact-agent/registry'
import type { ContactIdentity } from '../contact-agent/contracts'
import type { HarnessCoordinator } from '../harness/coordinator'
import type { HarnessInput, HarnessEvent } from '../harness/contracts'
import type { HarnessEngine } from '../../shared/harness'

export interface AgentSpaceOptions {
  harness: HarnessCoordinator
  work: WorkLoopTransport
  readIdentity(id: string): ContactIdentity | undefined
  modules?: readonly string[]
}

/** Application composition root. Worker execution is owned by WorkLoopHost. */
export class AgentSpace {
  private registry = new ModuleRegistry()
  private contacts = new Map<string, ContactAgent>()
  private retired = new Set<string>()
  private removing = new Map<string, Promise<void>>()
  private closed = false
  private closing?: Promise<void>
  constructor(private options: AgentSpaceOptions) {
    this.registry.register('chat', owner => new ContactChat(owner, options.harness))
    this.registry.register('workloop', owner => new ContactWorkLoop(owner, options.work))
    this.registry.resolve(options.modules ?? ['chat', 'workloop'])
  }
  syncContact(identity: ContactIdentity): ContactAgent {
    if (this.closed) throw new Error('联系人空间已关闭。')
    if (this.retired.has(identity.id)) throw new Error('联系人已删除或正在删除。')
    let contact = this.contacts.get(identity.id)
    if (contact) contact.update(identity)
    else {
      contact = new ContactAgent(identity, this.registry)
      contact.mount(this.options.modules ?? ['chat', 'workloop'])
      this.contacts.set(identity.id, contact)
    }
    return contact
  }
  private contact(id: string) {
    if (this.closed) throw new Error('联系人空间已关闭。')
    if (this.retired.has(id)) throw new Error('联系人已删除或正在删除。')
    const identity = this.options.readIdentity(id)
    if (!identity || identity.id !== id) throw new Error('联系人不存在。')
    return this.syncContact(identity)
  }
  workerIdentity(identity: ContactIdentity): ContactIdentity {
    const contact = this.syncContact(identity)
    return { ...identity, workLoopEnabled: Boolean(contact.module('workloop')) }
  }
  async runChat(input: HarnessInput, output: (event: HarnessEvent) => void, engine?: HarnessEngine) {
    if (!input.characterId) throw new Error('聊天缺少联系人归属。')
    const chat = this.contact(input.characterId).module('chat')?.chat
    if (!chat) throw new Error('联系人聊天模块未启用。')
    return chat.run(input, output, engine)
  }
  async cancelChat(requestId: string) {
    await Promise.all([...this.contacts.values()].map(contact => contact.module('chat')?.chat?.cancel(requestId)))
  }
  async request(method: string, id: string, args: unknown[] = []): Promise<any> {
    const work = this.contact(id).module('workloop')?.work
    if (!work) throw new Error('联系人工作模块未启用。')
    return work.request(method, args)
  }
  async detachModule(id: string, moduleId: string) { await this.contact(id).detach(moduleId) }
  async attachModule(id: string, moduleId: string) {
    const contact = this.contact(id)
    contact.mount([moduleId])
    if (moduleId === 'workloop') {
      try { await contact.module(moduleId)!.work!.request('attachModule', [moduleId]) }
      catch (error) { await contact.detach(moduleId); throw error }
    }
  }
  remove(id: string): Promise<void> {
    const pending = this.removing.get(id)
    if (pending) return pending
    this.retired.add(id)
    const contact = this.contacts.get(id)
    const removing = (async () => {
      await contact?.close()
      await this.options.work.remove(id)
      this.contacts.delete(id)
    })().catch(error => { this.removing.delete(id); throw error })
    this.removing.set(id, removing)
    return removing
  }
  close(): Promise<void> {
    if (this.closing) return this.closing
    this.closed = true
    this.closing = Promise.allSettled([...this.contacts.values()].map(contact => contact.close()).concat([...this.removing.values()])).then(results => {
      const failed = results.find((value): value is PromiseRejectedResult => value.status === 'rejected')
      if (failed) throw failed.reason
      this.contacts.clear()
    }).catch(error => { this.closing = undefined; throw error })
    return this.closing
  }
}
