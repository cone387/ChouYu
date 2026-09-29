import { useEffect, useState } from 'react'
export default function AgentQuestionState({ characterId, runId, content }: { characterId: string; runId: string; content: string }) {
  const [state, setState] = useState('正在确认处理状态…')
  useEffect(() => {
    let disposed = false, revision = 0
    const refresh = async () => {
      const request = ++revision
      try {
        const { run } = await window.electronAPI.agents.detail(characterId, runId)
        if (!disposed && request === revision) setState(run.status === 'waiting' && content.includes(`\n\n${run.question}\n\n`) ? '等待你的回复（已读不会结束等待）' : run.answer ? '已收到回复' : '本轮已不再等待回复')
      } catch { if (!disposed && request === revision) setState('处理状态暂不可用，请查看事项') }
    }
    void refresh()
    const off = window.electronAPI.agents.onChanged(id => { if (id === characterId) void refresh() })
    return () => { disposed = true; off() }
  }, [characterId, runId, content])
  return <span className="agent-question-state" role="status">{state}</span>
}
