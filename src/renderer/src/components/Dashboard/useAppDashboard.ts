import { useCallback, useEffect, useState } from 'react'
import { dashboardDays, localDayKey, type DashboardRange } from '../../../../shared/dashboard'
import { readJournalDays, summarizeSessions } from './appDashboardModel'
import { dashboardReadError, readUsageStatistics } from './dashboardReadError'

export interface DashboardResource<T> { data?: T; error: string; loading: boolean }
type Subscribe = (refresh: () => void) => () => void
const subscribeTasks: Subscribe = refresh => window.electronAPI.tasks.onChanged(refresh)
const subscribeSessions: Subscribe = refresh => window.electronAPI.onSessionsChanged(refresh)

/** Each domain can fail independently. A range change never presents the old range as current. */
function useResource<T>(active: boolean, key: string, reload: number, read: (signal: AbortSignal) => Promise<T>, subscribe?: Subscribe): DashboardResource<T> {
  const [state, setState] = useState<DashboardResource<T> & { key: string }>({ key, error: '', loading: true })
  useEffect(() => {
    if (!active) return
    let alive = true, busy = false, dirty = false
    const controller = new AbortController()
    let pending: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      if (!alive) return
      if (busy) { dirty = true; return }
      busy = true
      setState(previous => previous.key === key ? { ...previous, loading: true } : { key, error: '', loading: true })
      try {
        const data = await read(controller.signal)
        if (alive && !dirty) setState({ key, data, error: '', loading: false })
      } catch (error) {
        if (alive) setState(previous => {
          const data = previous.key === key ? previous.data : undefined
          return { key, data, error: dashboardReadError(error, data !== undefined), loading: false }
        })
      } finally { busy = false; if (alive && dirty) { dirty = false; void refresh() } }
    }
    const changed = () => { if (busy) dirty = true; clearTimeout(pending); pending = setTimeout(() => { void refresh() }, 150) }
    void refresh()
    const stop = subscribe?.(changed)
    const timer = setInterval(() => { void refresh() }, 60000)
    return () => { alive = false; controller.abort(); clearTimeout(pending); clearInterval(timer); stop?.() }
  }, [active, key, reload, read, subscribe])
  return state.key === key ? state : { error: '', loading: true }
}

export function useAppDashboard(active: boolean, range: DashboardRange, reload: number) {
  const [today, setToday] = useState(() => localDayKey(new Date()))
  useEffect(() => {
    if (!active) return
    const update = () => setToday(localDayKey(new Date()))
    update(); const timer = setInterval(update, 30000)
    return () => clearInterval(timer)
  }, [active])
  const readTasks = useCallback(() => window.electronAPI.tasks.statistics(range), [range, today])
  const readJournal = useCallback((signal: AbortSignal) => readJournalDays(dashboardDays(range), day => window.electronAPI.journal.overview(day), signal), [range, today])
  const readUsage = useCallback(() => readUsageStatistics(range), [range, today])
  const readSessions = useCallback(async () => summarizeSessions(await window.electronAPI.db.searchSessions('')), [])
  return {
    today,
    tasks: useResource(active, `${range}:${today}`, reload, readTasks, subscribeTasks),
    journal: useResource(active, `${range}:${today}`, reload, readJournal),
    usage: useResource(active, `${range}:${today}`, reload, readUsage),
    sessions: useResource(active, 'sessions', reload, readSessions, subscribeSessions)
  }
}
