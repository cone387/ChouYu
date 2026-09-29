import type { AgentSummary } from '../../../../shared/agents'

export type TokenFilter = 'all' | 'zero' | 'under10k' | '10kTo100k' | 'over100k' | 'unreported'
export type TaskFilter = 'all' | 'zero' | '1to5' | 'over5'
export type MetricSort = 'tokens-desc' | 'tokens-asc' | 'tasks-desc' | 'tasks-asc'
export function matchesMetrics(data: AgentSummary | undefined, tokens: TokenFilter, tasks: TaskFilter) {
  if (!data) return tokens === 'all' && tasks === 'all'
  if (tasks === 'zero' && data.tasks !== 0 || tasks === '1to5' && (data.tasks < 1 || data.tasks > 5) || tasks === 'over5' && data.tasks <= 5) return false
  if (tokens === 'all') return true
  if (tokens === 'unreported') return data.reported < data.calls
  if (data.calls > 0 && data.reported === 0) return false
  if (tokens === 'zero') return data.tokens === 0 && data.reported === data.calls
  if (tokens === 'under10k') return data.tokens > 0 && data.tokens < 10000
  if (tokens === '10kTo100k') return data.tokens >= 10000 && data.tokens < 100000
  return data.tokens >= 100000
}
export function compareMetrics(a: AgentSummary | undefined, b: AgentSummary | undefined, sort: MetricSort) {
  const token = sort.startsWith('tokens')
  const value = (data?: AgentSummary) => !data || token && data.calls > 0 && !data.reported ? undefined : token ? data.tokens : data.tasks
  const left = value(a), right = value(b)
  if (left === undefined || right === undefined) return left === right ? 0 : left === undefined ? 1 : -1
  return (left - right) * (sort.endsWith('desc') ? -1 : 1)
}
