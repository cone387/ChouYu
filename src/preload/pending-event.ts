// Keep an activation received before React mounts its listener. Repeated clicks
// during startup should open the panel once, rather than disappear or replay.
export function createPendingEvent() {
  const listeners = new Set<() => void>()
  let pending = false
  return {
    emit() {
      if (!listeners.size) pending = true
      else for (const listener of listeners) listener()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      if (pending) {
        pending = false
        listener()
      }
      return () => { listeners.delete(listener) }
    }
  }
}
