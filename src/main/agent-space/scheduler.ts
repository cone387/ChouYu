export interface RunKey { id: string; characterId: string; topicId: string | null }
export interface ActiveRun extends RunKey { controller: AbortController; promise: Promise<void> }

/** Only executing requests occupy slots. Cancellation does not release a live request. */
export class RunScheduler {
  private readonly active = new Map<string, ActiveRun>()
  constructor(readonly capacity = 8, private failed: (error: unknown, run: RunKey) => void = () => {}) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('执行并发上限必须是正整数。')
  }
  get size() { return this.active.size }
  get(id: string) { return this.active.get(id) }
  activeFor(characterId: string, topicId?: string) {
    return [...this.active.values()].filter(run => run.characterId === characterId && (topicId === undefined || run.topicId === topicId))
  }
  canStart(run: RunKey, limit: number) {
    const own = this.activeFor(run.characterId)
    return Number.isSafeInteger(limit) && limit > 0 && this.size < this.capacity && !this.active.has(run.id)
      && own.length < limit && !own.some(current => current.topicId === run.topicId)
  }
  launch(run: RunKey, limit: number, execute: (signal: AbortSignal) => Promise<void>): boolean {
    if (!this.canStart(run, limit)) return false
    const controller = new AbortController()
    const entry: ActiveRun = { ...run, controller, promise: undefined! }
    this.active.set(run.id, entry)
    entry.promise = Promise.resolve().then(() => execute(controller.signal))
      .catch(error => { this.failed(error, run) })
      .finally(() => { if (this.active.get(run.id) === entry) this.active.delete(run.id) })
    return true
  }
  abort(characterId: string, topicId?: string) { for (const run of this.activeFor(characterId, topicId)) run.controller.abort() }
  async drain(characterId?: string) {
    await Promise.all([...this.active.values()].filter(run => characterId === undefined || run.characterId === characterId).map(run => run.promise))
  }
}
