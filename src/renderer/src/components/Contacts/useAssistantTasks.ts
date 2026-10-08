import { useEffect, useState } from 'react'
import { ASSISTANT_DUTIES, type AssistantDutyKey } from '../../../../shared/assistant-duties'
import type { AppConfig } from '../../../../shared/config'
import type { AssistantRoutine } from '../../../../shared/assistant-routines'

export type AssistantTaskEntry = { id: string; title: string; status: string; description: string; duty?: AssistantDutyKey; routine?: AssistantRoutine }
export function useAssistantTasks(active: boolean) {
  const [routines, setRoutines] = useState<AssistantRoutine[]>([])
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const refresh = async () => {
    try {
      const [items, settings] = await Promise.all([window.electronAPI.assistantRoutines.list(), window.electronAPI.db.getConfig()])
      setRoutines(items); setConfig(settings); setLoaded(true); setError('')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  useEffect(() => {
    if (!active) return
    void refresh()
    const off = window.electronAPI.assistantRoutines.onChanged(() => { void refresh() })
    const offConfig = window.electronAPI.onConfigChanged(setConfig)
    const timer = setInterval(() => { void refresh() }, 15000)
    return () => { off(); offConfig(); clearInterval(timer) }
  }, [active])
  const entries: AssistantTaskEntry[] = !active ? [] : [
    ...(config ? ASSISTANT_DUTIES.map(duty => ({ id: `duty:${duty.key}`, title: duty.title, status: config[duty.key] ? '已启用' : '已暂停', description: `${duty.rule}${duty.key !== 'proactiveGreeting' && config ? ` 当前：离开 ${config.proactiveReturnAwayMinutes} 分钟、连续使用 ${config.proactiveRestMinutes} 分钟、冷却 ${config.proactiveCooldownMinutes} 分钟。` : ''}`, duty: duty.key })) : []),
    ...routines.map(routine => ({ id: `routine:${routine.id}`, title: routine.title, status: routine.enabled ? '已启用' : '已暂停', description: routine.instruction, routine })),
    ...(loaded && !routines.some(item => item.kind === 'contact-summary') ? [{ id: 'morning-summary', title: '联系人晨间总结', status: '未配置', description: '告诉我希望几点检查各联系人的进展，我会按时汇总需要你关注的事情。' }] : [])
  ]
  return { entries, config, error, refresh }
}
