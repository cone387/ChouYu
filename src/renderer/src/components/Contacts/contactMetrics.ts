import type { AgentSummary } from '../../../../shared/agents'

export type MetricSort = 'tokens-desc' | 'tokens-asc' | 'tasks-desc' | 'tasks-asc'
export function compareMetrics(a: AgentSummary | undefined, b: AgentSummary | undefined, sort: MetricSort) {
  const token = sort.startsWith('tokens')
  const value = (data?: AgentSummary) => !data || token && data.calls > 0 && !data.reported ? undefined : token ? data.tokens : data.tasks
  const left = value(a), right = value(b)
  if (left === undefined || right === undefined) return left === right ? 0 : left === undefined ? 1 : -1
  return (left - right) * (sort.endsWith('desc') ? -1 : 1)
}
