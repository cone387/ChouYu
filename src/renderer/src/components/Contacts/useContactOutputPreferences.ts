import { useEffect, useState } from 'react'
import type { ContactOutputPreference } from '../../../../shared/contact-output'
import { contactQueries } from './contactQueries'

export function useContactOutputPreferences(owner: string, topicId?: string, version?: number, active = true) {
  const [preferences, setPreferences] = useState<ContactOutputPreference[]>([])
  useEffect(() => {
    setPreferences([])
    if (!active) return
    let current = true
    const refresh = async () => {
      try {
        const records = await contactQueries.read(owner, 'outputPreferences', [topicId, version], () => window.electronAPI.agents.outputPreferences(owner, topicId, version))
        if (current) setPreferences(records.map(record => record.preference))
      } catch { if (current) setPreferences([]) }
    }
    const dispose = contactQueries.watch(owner, refresh, 60000)
    return () => { current = false; dispose() }
  }, [owner, topicId, version, active])
  return preferences
}
