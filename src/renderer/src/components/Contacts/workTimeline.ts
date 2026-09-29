import type { AgentAnalytics, ActivitySpan } from '../../../../shared/agent-analytics'

export const timelineStates = { running: '执行', waiting: '心跳 · 休息', queued: '心跳 · 休息', interrupted: '心跳 · 休息', heartbeat: '心跳 · 休息' }
export type WorkSegment = Omit<ActivitySpan, 'state'> & { state: ActivitySpan['state'] | 'heartbeat'; key: string; text: string }

export function workTimelineRows(data: AgentAnalytics) {
  const segments = workSegments(data)
  const rows = new Map<string, { key: string; text: string; running: boolean; ranges: WorkSegment[] }>()
  for (const segment of segments) {
    const running = segment.state === 'running'
    const key = running ? `task:${segment.topicId ?? 'legacy'}` : 'heartbeat'
    let row = rows.get(key)
    if (!row) {
      row = { key, running, text: running ? data.tasks.find(task => task.id === segment.topicId)?.title || '处理任务' : '心跳', ranges: [] }
      rows.set(key, row)
    }
    // Group for display only: never fill across another task or a rest period.
    row.ranges.push({ ...segment })
  }
  return [...rows.values()]
}

/** Only recorded run intervals become bars; gaps and future time remain blank. */
export function workSegments(data: AgentAnalytics): WorkSegment[] {
  const segments: WorkSegment[] = data.spans.flatMap(span => {
    const start = Math.max(span.start, data.start), end = Math.min(span.end, data.end, data.measuredAt)
    if (end <= start) return []
    return [{ ...span, start, end, key: `${span.runId}:${start}:${span.state}`, text: '' }]
  })
  for (const heartbeat of data.heartbeats ?? []) {
    const start = Math.max(data.start, heartbeat.start), end = Math.min(data.end, data.measuredAt, heartbeat.end)
    if (end > start) segments.push({ ...heartbeat, start, end, runId: '', state: 'heartbeat', approximate: false, key: `heartbeat:${heartbeat.id}`, text: '心跳 · 持续工作待命' })
  }
  segments.sort((a, b) => a.start - b.start)
  // Resolve every boundary once, so each instant has exactly one recorded state.
  // Execution wins over stale waiting/heartbeat records. For overlapping runs,
  // prefer precise records, then the most recently started activity.
  const boundaries = [...new Set(segments.flatMap(segment => [segment.start, segment.end]))].sort((a, b) => a - b)
  const periods: WorkSegment[] = []
  for (let index = 0; index < boundaries.length - 1; index++) {
    const start = boundaries[index], end = boundaries[index + 1]
    const winner = segments.filter(segment => segment.start <= start && segment.end >= end)
      .sort((a, b) => Number(b.state === 'running') - Number(a.state === 'running') || Number(a.approximate) - Number(b.approximate) || b.start - a.start || a.key.localeCompare(b.key))[0]
    if (!winner) continue
    const segment = { ...winner, start, end, state: winner.state === 'running' ? 'running' as const : 'heartbeat' as const, key: `${winner.key}:${start}` }
    const previous = periods.at(-1)
    const sameState = previous && previous.state === segment.state && (segment.state !== 'running' || previous.topicId === segment.topicId)
    const adjacent = previous && (previous.end === start || segment.state === 'heartbeat' && start - previous.end <= 60000)
    if (sameState && adjacent) {
      previous.end = segment.end
      previous.approximate ||= segment.approximate
    } else periods.push({ ...segment })
  }
  const phases: Record<string, string> = { briefing: '梳理任务', planning: '制定计划', plan: '制定计划', search: '搜索资料', reading: '阅读资料', read: '阅读资料', analysis: '分析资料', drafting: '撰写内容', revising: '修改内容', checking: '检查成果', completed: '完成本轮' }
  return periods.map(period => {
    const steps = [...new Set((data.logs ?? []).filter(event => event.topicId === period.topicId && event.at >= period.start && event.at <= period.end)
      .sort((a, b) => a.at - b.at).map(event => phases[event.kind]).filter(Boolean))]
    const title = data.tasks.find(task => task.id === period.topicId)?.title || '处理任务'
    return { ...period, text: period.state === 'running' ? `${title}${steps.length ? ` · ${steps.join('、')}` : ''}` : timelineStates[period.state] }
  })
}
