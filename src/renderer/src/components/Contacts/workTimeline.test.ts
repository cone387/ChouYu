import { expect, it } from 'vitest'
import { emptyUsage, type AgentAnalytics } from '../../../../shared/agent-analytics'
import { workSegments } from './workTimeline'

it('clips midnight and future time, splits steps, and leaves unrecorded gaps blank', () => {
  const data: AgentAnalytics = { start: 100, end: 1000, measuredAt: 800, totals: emptyUsage(), buckets: [], tasks: [], activity: [], legacyCalls: 0,
    spans: [{ runId: 'a', topicId: 'task', start: 50, end: 400, state: 'running', approximate: false }, { runId: 'b', topicId: 'task', start: 600, end: 900, state: 'waiting', approximate: true }],
    logs: [{ id: 1, runId: 'a', topicId: 'task', at: 200, text: '搜索资料', kind: 'search' }, { id: 2, runId: 'a', topicId: 'task', at: 300, text: '撰写结论\n细节', kind: 'drafting' }],
    heartbeats: [{ id: 1, topicId: 'task', start: 450, end: 500 }] }
  const segments = workSegments(data)
  expect(segments.map(s => [s.start, s.end])).toEqual([[100, 200], [200, 300], [300, 400], [450, 500], [600, 800]])
  expect(segments[1].text).toBe('搜索资料')
  expect(segments[2].text).toBe('撰写结论')
  expect(segments[3].state).toBe('heartbeat')
  expect(segments[4].text).toContain('心跳')
  expect(segments[4].approximate).toBe(true)
})
