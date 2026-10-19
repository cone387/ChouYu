import type { ContactIdentity, ContactModule, ContactModuleOwner } from './contracts'
import { ModuleRegistry } from './registry'

export class ContactAgent implements ContactModuleOwner {
  private modules = new Map<string, ContactModule>()
  private retiring = new Map<string, ContactModule>()
  private draining = new Map<string, Promise<void>>()
  private closed = false
  private closing?: Promise<void>
  private current: ContactIdentity
  constructor(identity: ContactIdentity, private registry: ModuleRegistry) { this.current = structuredClone(identity) }
  get id() { return this.current.id }
  get identity(): ContactIdentity { return this.current }
  module(id: string): ContactModule | undefined { return this.closed ? undefined : this.modules.get(id) }
  update(identity: ContactIdentity) {
    if (identity.id !== this.id || this.closed) throw new Error('联系人实例不能更换归属或在关闭后更新。')
    this.current = structuredClone(identity)
  }
  mount(ids: readonly string[]) {
    if (this.closed) throw new Error('联系人已关闭。')
    const definitions = this.registry.resolve(ids)
    if (ids.some(id => this.retiring.has(id))) throw new Error('联系人模块正在卸载或卸载失败，请等待或重试。')
    if (ids.some(id => this.modules.has(id))) throw new Error('联系人模块已装配。')
    for (const { id, factory } of definitions) this.modules.set(id, factory(this))
  }
  prepare() { if (!this.closed) for (const module of this.modules.values()) module.prepare?.() }
  advance() {
    if (this.closed) return false
    let started = false
    for (const module of this.modules.values()) started = Boolean(module.advance?.()) || started
    return started
  }
  detach(id: string): Promise<void> {
    const pending = this.draining.get(id)
    if (pending) return pending
    const module = this.retiring.get(id) ?? this.modules.get(id)
    if (!module) return Promise.resolve()
    this.modules.delete(id)
    this.retiring.set(id, module)
    // Invoke close immediately so cancellation is visible before this method returns.
    let result: Promise<void>
    try { result = module.close() } catch (error) { result = Promise.reject(error) }
    const draining = result.then(() => { this.retiring.delete(id) }).finally(() => { this.draining.delete(id) })
    this.draining.set(id, draining)
    return draining
  }
  close(): Promise<void> {
    if (this.closing) return this.closing
    this.closed = true
    this.closing = Promise.allSettled([...new Set([...this.modules.keys(), ...this.retiring.keys()])].map(id => this.detach(id))).then(results => {
      const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failed) throw failed.reason
    }).catch(error => { this.closing = undefined; throw error })
    return this.closing
  }
}
