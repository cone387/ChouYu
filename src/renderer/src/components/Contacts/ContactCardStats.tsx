import type { AgentSummary } from '../../../../shared/agents'
import { ACTIVE_TASKS_HINT, summaryTokenHint, summaryTokens } from './useAgentSummary'

export default function ContactCardStats({ data, error, lastWorkedAt }: { data?: AgentSummary; error?: string; lastWorkedAt?: number }) {
  const date = lastWorkedAt ? new Date(lastWorkedAt) : null
  const stamp = date ? `${date.toDateString() === new Date().toDateString() ? '今天' : date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })} ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}` : ''
  return <span className="contacts-card-stats" aria-label="联系人任务统计">
    <span title={error || ACTIVE_TASKS_HINT}><strong>{data?.activeTasks ?? '—'}</strong> 进行中 <small>/ {data?.tasks ?? '—'} 个任务</small></span>
    <span title={error || summaryTokenHint(data)}><strong>{summaryTokens(data)}</strong> Token <small>累计</small></span>
    <span title={error || '此联系人当前保留的独立记忆条数'}><strong>{data?.memories ?? '—'}</strong> 记忆</span>
    <span className="contacts-card-last-work" title={error || (date ? `最近工作记录：${date.toLocaleString('zh-CN', { hour12: false })}` : '尚无工作记录')}>
      最近工作 {error || !data ? '—' : date ? <time dateTime={date.toISOString()}>{stamp}</time> : '暂无'}
    </span>
  </span>
}
