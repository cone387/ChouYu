import type { ContactIdentity, ContactModule, ContactModuleOwner } from './contracts'
import { ModuleRegistry } from './registry'

export class ContactAgent implements ContactModuleOwner {
  private modules = new Map<string, ContactModule>()
  private closed = false
  private closing?: Promise<void>
  private current: ContactIdentity
  constructor(identity: ContactIdentity, private registry: ModuleRegistry) { this.current = structuredClone(identity) }
  get id() { return this.current.id }
  get identity(): ContactIdentity { return this.current }
  update(identity: ContactIdentity) {
    if (identity.id !== this.id || this.closed) throw new Error('联系人实例不能更换归属或在关闭后更新。')
    this.current = structuredClone(identity)
  }
  mount(ids: readonly string[]) {
    if (this.closed || this.modules.size) throw new Error('联系人模块已装配或联系人已关闭。')
    const definitions = this.registry.resolve(ids)
    for (const { id, factory } of definitions) this.modules.set(id, factory(this))
  }
  prepare() { if (!this.closed) for (const module of this.modules.values()) module.prepare?.() }
  advance() {
    if (this.closed) return false
    let started = false
    for (const module of this.modules.values()) started = Boolean(module.advance?.()) || started
    return started
  }
  async detach(id: string) {
    const module = this.modules.get(id)
    if (!module) return
    this.modules.delete(id)
    await module.close()
  }
  close(): Promise<void> {
    if (this.closing) return this.closing
    this.closed = true
    this.closing = Promise.all([...this.modules.values()].map(module => module.close())).then(() => { this.modules.clear() })
    return this.closing
  }
}
