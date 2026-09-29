import type { AgentSummary } from '../../../../shared/agents'
import { ACTIVE_TASKS_HINT, summaryTokenHint, summaryTokens } from './useAgentSummary'

export default function ContactCardStats({ data, error }: { data?: AgentSummary; error?: string }) {
  return <span className="contacts-card-stats" aria-label="联系人任务统计">
    <span title={error || ACTIVE_TASKS_HINT}><strong>{data?.activeTasks ?? '—'}</strong> 进行中 <small>/ {data?.tasks ?? '—'} 个任务</small></span>
    <span title={error || summaryTokenHint(data)}><strong>{summaryTokens(data)}</strong> Token <small>累计</small></span>
    <span title={error || '此联系人当前保留的独立记忆条数'}><strong>{data?.memories ?? '—'}</strong> 记忆</span>
  </span>
}
