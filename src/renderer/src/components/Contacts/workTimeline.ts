import type { AgentAnalytics, ActivitySpan } from '../../../../shared/agent-analytics'

export const timelineStates = { running: '执行', waiting: '心跳 · 等待回复', queued: '心跳 · 等待调度', interrupted: '心跳 · 等待恢复', heartbeat: '心跳' }
export type WorkSegment = Omit<ActivitySpan, 'state'> & { state: ActivitySpan['state'] | 'heartbeat'; key: string; text: string }

/** Only recorded run intervals become bars; gaps and future time remain blank. */
export function workSegments(data: AgentAnalytics): WorkSegment[] {
  const byRun = new Map<string, NonNullable<AgentAnalytics['logs']>>()
  for (const event of [...(data.logs ?? [])].sort((a, b) => a.at - b.at || a.id - b.id)) {
    const events = byRun.get(event.runId) ?? []
    events.push(event); byRun.set(event.runId, events)
  }
  const segments: WorkSegment[] = data.spans.flatMap(span => {
    const start = Math.max(span.start, data.start), end = Math.min(span.end, data.end, data.measuredAt)
    if (end <= start) return []
    const events = byRun.get(span.runId) ?? []
    const cuts = [start, ...new Set(events.filter(event => event.at > start && event.at < end).map(event => event.at)), end]
    return cuts.slice(0, -1).map((from, index) => {
      const event = events.findLast(event => event.at <= from)
      return { ...span, start: from, end: cuts[index + 1], key: `${span.runId}:${from}:${span.state}`,
        text: span.state === 'running' ? event?.text.split('\n')[0] || '执行本轮任务' : timelineStates[span.state] }
    })
  })
  for (const heartbeat of data.heartbeats ?? []) {
    const start = Math.max(data.start, heartbeat.start), end = Math.min(data.end, data.measuredAt, heartbeat.end)
    if (end > start) segments.push({ ...heartbeat, start, end, runId: '', state: 'heartbeat', approximate: false, key: `heartbeat:${heartbeat.id}`, text: '心跳 · 持续工作待命' })
  }
  return segments.sort((a, b) => a.start - b.start)
}
