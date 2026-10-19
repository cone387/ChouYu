/** Contact-scoped wake subscriptions; task data stays in ContactTaskStore. */
export class ContactEvents {
  private listeners = new Map<string, Set<() => void>>()
  subscribe(id: string, listener: () => void) {
    const set = this.listeners.get(id) ?? new Set<() => void>()
    set.add(listener); this.listeners.set(id, set)
    return () => { set.delete(listener); if (!set.size) this.listeners.delete(id) }
  }
  publish(id: string) { for (const listener of [...this.listeners.get(id) ?? []]) listener() }
  clear() { this.listeners.clear() }
}
