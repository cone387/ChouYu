import type { AgentAnalytics, ActivitySpan } from '../../../../shared/agent-analytics'

export const timelineStates = { running: '执行', waiting: '心跳 · 等待回复', queued: '心跳 · 等待调度', interrupted: '心跳 · 等待恢复', heartbeat: '心跳' }
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
    const previous = row.ranges.at(-1)
    // Sampling boundaries can differ by seconds. Do not bridge another activity
    // or a real offline gap, but never create extra rows for another run.
    const intervening = previous && segments.some(other => (other.state === 'running') !== running && other.start < segment.start && other.end > previous.end)
    if (previous && segment.start <= previous.end + 60000 && !intervening) {
      previous.end = Math.max(previous.end, segment.end)
      previous.approximate ||= segment.approximate
    } else row.ranges.push({ ...segment })
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
  // Brief dispatch immediately adjoining work belongs to the same work period.
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    if (segment.state !== 'queued' || segment.end - segment.start > 60000) continue
    if ([segments[index - 1], segments[index + 1]].some(other => other?.state === 'running' && other.runId === segment.runId && (other.end === segment.start || other.start === segment.end))) segment.state = 'running'
  }
  const periods: WorkSegment[] = []
  for (const segment of segments) {
    const previous = periods.at(-1)
    if (previous && previous.topicId === segment.topicId && previous.end === segment.start && (previous.state === 'running') === (segment.state === 'running')) {
      previous.end = segment.end
      previous.approximate ||= segment.approximate
      if (previous.state !== segment.state) previous.state = 'heartbeat'
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
