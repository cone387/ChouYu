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
}
