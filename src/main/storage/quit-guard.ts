import type { StorageStatus } from '../../shared/storage'

/** Every quit stage flushes again: background work can finish during shutdown. */
export class StorageQuitGuard {
  private discard = false
  constructor(private flush: () => StorageStatus, private confirmDiscard: (error: string) => boolean) {}
  mayExit(): boolean {
    const status = this.flush()
    if (!status.error || this.discard) return true
    this.discard = this.confirmDiscard(status.error)
    return this.discard
  }
  /** After draining, keep an explicit recovery surface until saved or discarded.
   * Returning to the normal UI here would expose services already closed. */
  async finish(drain: () => Promise<unknown>, recover: (error: string) => Promise<'retry' | 'discard'>): Promise<void> {
    await drain()
    for (;;) {
      const status = this.flush()
      if (!status.error || this.discard) return
      if (await recover(status.error) === 'discard') { this.discard = true; return }
    }
  }
}
