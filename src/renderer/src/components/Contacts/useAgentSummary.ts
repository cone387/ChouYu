import { useEffect, useState } from 'react'
import type { AgentSummary } from '../../../../shared/agents'
import { DEFAULT_CHARACTER_ID } from '../../../../shared/characters'

export function useAgentSummary(characterId: string, active = true) {
  const [state, setState] = useState<{ id: string; data?: AgentSummary; error?: string }>({ id: characterId })
  useEffect(() => {
    if (!active) return
    let alive = true, sequence = 0
    let pending: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      const current = ++sequence
      try {
        const [work, routines] = await Promise.all([
          window.electronAPI.agents.summary(characterId),
          characterId === DEFAULT_CHARACTER_ID ? window.electronAPI.assistantRoutines.list() : Promise.resolve([])
        ])
        const data = { ...work, tasks: work.tasks + routines.length, activeTasks: work.activeTasks + routines.filter(item => item.enabled).length }
        if (alive && current === sequence) setState({ id: characterId, data })
      } catch {
        if (alive && current === sequence) setState({ id: characterId, error: '统计暂时不可用' })
      }
    }
    void refresh()
    const dispose = window.electronAPI.agents.onChanged(id => {
      if (id !== characterId) return
      clearTimeout(pending); pending = setTimeout(() => { void refresh() }, 150)
    })
    const timer = setInterval(() => { void refresh() }, 30000)
    const disposeRoutines = characterId === DEFAULT_CHARACTER_ID ? window.electronAPI.assistantRoutines.onChanged(() => { void refresh() }) : () => {}
    return () => { alive = false; clearTimeout(pending); clearInterval(timer); dispose(); disposeRoutines() }
  }, [characterId, active])
  return state.id === characterId ? state : { id: characterId }
}

export const ACTIVE_TASKS_HINT = '进行中包含研究、待补证据和已启动的排队或待回复任务；不含尚未启动、暂停、已结束、已放弃任务。'
export function summaryTokens(data?: AgentSummary) {
  if (!data) return '—'
  if (data.calls && !data.reported) return '未记录'
  return `${new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(data.tokens)}${data.reported < data.calls ? '*' : ''}`
}
export function summaryTokenHint(data?: AgentSummary) {
  if (!data) return '正在读取任务累计 Token'
  return `任务累计 ${data.tokens.toLocaleString('zh-CN')} Token；已记录 ${data.reported}/${data.calls} 次调用。包含失败与重试，不含普通聊天。${data.reported < data.calls ? ' * 表示部分用量未返回或未记录，不按零消耗计算。' : ''}`
}
