type Subscription = (listener: (owner: string) => void) => () => void
type Watcher = { refresh: () => unknown; interval: number; next: number }
type Group = { watchers: Set<Watcher>; timer: ReturnType<typeof setInterval>; pending?: ReturnType<typeof setTimeout> }

/** Only in-flight values are shared. Visibility returns always read the saved state. */
export class ContactQueries {
  private flights = new Map<string, Promise<unknown>>()
  private revisions = new Map<string, number>()
  private groups = new Map<string, Group>()
  private unsubscribe?: () => void
  constructor(private subscribe?: Subscription) {}
  invalidate(owner: string) { this.revisions.set(owner, (this.revisions.get(owner) ?? 0) + 1) }
  read<T>(owner: string, method: string, args: unknown[], load: () => Promise<T>): Promise<T> {
    const revision = this.revisions.get(owner) ?? 0
    const key = JSON.stringify([owner, method, args, revision])
    const existing = this.flights.get(key)
    if (existing) return existing as Promise<T>
    const pending = load().then(value => revision === (this.revisions.get(owner) ?? 0) ? value : this.read(owner, method, args, load), error => {
      if (revision !== (this.revisions.get(owner) ?? 0)) return this.read(owner, method, args, load)
      throw error
    }).finally(() => { if (this.flights.get(key) === pending) this.flights.delete(key) })
    this.flights.set(key, pending)
    return pending
  }
  watch(owner: string, refresh: () => unknown, interval: number) {
    if (!this.unsubscribe && this.subscribe) this.unsubscribe = this.subscribe(id => {
      this.invalidate(id)
      const group = this.groups.get(id)
      if (!group || group.pending) return
      group.pending = setTimeout(() => { group.pending = undefined; for (const watcher of group.watchers) void watcher.refresh() }, 150)
    })
    let group = this.groups.get(owner)
    if (!group) {
      this.invalidate(owner)
      const watchers = new Set<Watcher>()
      group = { watchers, timer: setInterval(() => {
        const now = Date.now()
        for (const watcher of watchers) if (now >= watcher.next) { watcher.next = now + watcher.interval; void watcher.refresh() }
      }, 1000) }
      this.groups.set(owner, group)
    }
    const watcher = { refresh, interval, next: Date.now() + interval }
    group.watchers.add(watcher); void refresh()
    return () => {
      group.watchers.delete(watcher)
      if (!group.watchers.size) { clearInterval(group.timer); clearTimeout(group.pending); this.groups.delete(owner) }
      if (!this.groups.size) { this.unsubscribe?.(); this.unsubscribe = undefined }
    }
  }
}

export const contactQueries = new ContactQueries(listener => window.electronAPI.agents.onChanged(listener))
