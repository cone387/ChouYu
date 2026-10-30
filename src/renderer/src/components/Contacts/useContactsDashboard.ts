import { useContactVisible } from './useContactVisible'
import { useEffect, useState } from 'react'
import type { AgentDashboard } from '../../../../shared/agents'

export function useContactsDashboard(surfaceActive: boolean, reloadKey = 0) {
  const active = useContactVisible(surfaceActive)
  const [data, setData] = useState<AgentDashboard>()
  const [error, setError] = useState('')
  useEffect(() => {
    if (!active) return
    let alive = true, inFlight = false, dirty = false
    let pending: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      if (!alive) return
      if (inFlight) { dirty = true; return }
      inFlight = true
      try {
        const next = await window.electronAPI.agents.dashboard()
        if (alive && !dirty) { setData(next); setError('') }
      } catch { if (alive) setError('活动与统计读取失败，正在重连；当前保留上次数据。') }
      finally {
        inFlight = false
        if (alive && dirty) { dirty = false; void refresh() }
      }
    }
    const changed = () => { if (inFlight) dirty = true; clearTimeout(pending); pending = setTimeout(() => { void refresh() }, 150) }
    void refresh()
    const disposeAgents = window.electronAPI.agents.onChanged(changed)
    const disposeCharacters = window.electronAPI.characters.onChanged(changed)
    const timer = setInterval(() => { void refresh() }, 5000)
    return () => { alive = false; clearTimeout(pending); clearInterval(timer); disposeAgents(); disposeCharacters() }
  }, [active, reloadKey])
  return { data, error }
}
