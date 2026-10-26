import { AsyncLocalStorage } from 'node:async_hooks'

export interface StorageLease {
  /** Call only after the graph invocation and all its checkpoint writes settled. */
  boundary(): Promise<void>
  onDrain(callback?: () => void): void
}
type Token = { active: boolean; drain?: () => void }
export class StorageBoundaryTimeout extends Error {
  constructor() { super('等待联系人存储安全边界超时，本次备份已跳过。') }
}
/** A cooperative admission barrier, never a cancellation mechanism. */
export class ContactStorageBarrier {
  private context = new AsyncLocalStorage<Token>()
  private active = new Set<Token>()
  private waiting = new Set<() => void>()
  private idle?: () => void
  private pending = false
  private saving = false
  get blocked() { return this.pending }
  detached<T>(fn: () => T): T { return this.context.exit(fn) }
  private async enter(token: Token) {
    while (this.pending) await new Promise<void>(resolve => this.waiting.add(resolve))
    token.active = true; this.active.add(token)
  }
  private leave(token: Token) {
    token.active = false; this.active.delete(token)
    if (!this.active.size) this.idle?.()
  }
  controlOperation<T>(fn: (lease: StorageLease) => T | Promise<T>): Promise<T> { return this.operation(fn, true) }
  async operation<T>(fn: (lease: StorageLease) => T | Promise<T>, completing = false): Promise<T> {
    const parent = this.context.getStore()
    const token: Token = { active: false }
    // Preserve synchronous admission for scheduler mutations.
    if (this.pending && !parent?.active && !(completing && !this.saving)) await this.enter(token)
    else { token.active = true; this.active.add(token) }
    const lease: StorageLease = {
      boundary: async () => { token.drain = undefined; this.leave(token); await this.enter(token) },
      onDrain: callback => { token.drain = callback; if (this.pending) callback?.() }
    }
    try { return await this.context.run(token, () => fn(lease)) }
    finally { token.drain = undefined; this.leave(token) }
  }
  async snapshot<T>(fn: () => T | Promise<T>, timeoutMs = 30000): Promise<T> {
    if (this.pending) throw new Error('已有联系人备份正在等待或保存。')
    this.pending = true
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new StorageBoundaryTimeout()), timeoutMs)
      })
      for (const token of this.active) token.drain?.()
      while (this.active.size) await Promise.race([new Promise<void>(resolve => { this.idle = resolve }), timeout])
      clearTimeout(timer); this.idle = undefined
      this.saving = true
      return await fn()
    } finally {
      clearTimeout(timer); this.idle = undefined; this.pending = false; this.saving = false
      for (const resume of this.waiting) resume()
      this.waiting.clear()
    }
  }
}
