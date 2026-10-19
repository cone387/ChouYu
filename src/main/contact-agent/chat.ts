import type { ContactModule, ContactModuleOwner, ContactChatPort } from './contracts'
import type { HarnessCoordinator } from '../harness/coordinator'
import type { HarnessInput, HarnessEvent, HarnessResult } from '../harness/contracts'
import type { HarnessEngine } from '../../shared/harness'

/** Owns one contact's chat lifetime; Harness still owns provider and tool execution. */
export class ContactChat implements ContactModule, ContactChatPort {
  readonly id = 'chat'
  readonly chat = this
  private active = new Map<string, { abort: AbortController; settled: Promise<unknown> }>()
  private closed = false
  private closing?: Promise<void>
  constructor(private owner: ContactModuleOwner, private harness: HarnessCoordinator) {}
  async run(input: HarnessInput, output: (event: HarnessEvent) => void, engine?: HarnessEngine): Promise<HarnessResult> {
    if (this.closed) throw new Error('联系人聊天模块已关闭。')
    if (input.characterId !== this.owner.id) throw new Error('聊天归属与联系人不一致。')
    if (this.active.has(input.requestId)) throw new Error('相同聊天请求仍在执行。')
    const abort = new AbortController()
    const bound = { ...input, signal: AbortSignal.any([input.signal, abort.signal]) }
    // Defer execution until the entry exists: synchronous callbacks can request cancellation.
    const settled = Promise.resolve().then(() => this.harness.run(bound, output, engine))
    const entry = { abort, settled }
    this.active.set(input.requestId, entry)
    try { return await settled }
    finally { if (this.active.get(input.requestId) === entry) this.active.delete(input.requestId) }
  }
  async cancel(requestId: string) {
    const run = this.active.get(requestId)
    if (run) { run.abort.abort(); await run.settled }
  }
  close(): Promise<void> {
    if (this.closing) return this.closing
    this.closed = true
    const active = [...this.active.values()]
    for (const run of active) run.abort.abort()
    this.closing = Promise.allSettled(active.map(run => run.settled)).then(() => {})
    return this.closing
  }
}
