import { expect, it } from 'vitest'
import { emptyUsage, type AgentAnalytics } from '../../../../shared/agent-analytics'
import { workSegments } from './workTimeline'

it('summarizes steps into work periods, clips boundaries and leaves unrecorded gaps blank', () => {
  const data: AgentAnalytics = { start: 100, end: 1000, measuredAt: 800, totals: emptyUsage(), buckets: [], tasks: [], activity: [], legacyCalls: 0,
    spans: [{ runId: 'a', topicId: 'task', start: 50, end: 400, state: 'running', approximate: false }, { runId: 'b', topicId: 'task', start: 600, end: 900, state: 'waiting', approximate: true }],
    logs: [{ id: 1, runId: 'a', topicId: 'task', at: 200, text: '搜索资料', kind: 'search' }, { id: 2, runId: 'a', topicId: 'task', at: 300, text: '撰写结论\n细节', kind: 'drafting' }],
    heartbeats: [{ id: 1, topicId: 'task', start: 450, end: 500 }] }
  const segments = workSegments(data)
  expect(segments.map(s => [s.start, s.end])).toEqual([[100, 400], [450, 500], [600, 800]])
  expect(segments[0].text).toContain('搜索资料、撰写内容')
  expect(segments[1].state).toBe('heartbeat')
  expect(segments[2].text).toContain('心跳')
  expect(segments[2].approximate).toBe(true)
})
it('absorbs brief dispatch into work and combines adjoining heartbeat periods', () => {
  const data: AgentAnalytics = { start: 0, end: 100000, measuredAt: 90000, totals: emptyUsage(), buckets: [], tasks: [], activity: [], legacyCalls: 0,
    spans: [{ runId: 'a', topicId: 'task', start: 0, end: 100, state: 'queued', approximate: false }, { runId: 'a', topicId: 'task', start: 100, end: 10000, state: 'running', approximate: false }, { runId: 'a', topicId: 'task', start: 10000, end: 20000, state: 'waiting', approximate: false }],
    heartbeats: [{ id: 1, topicId: 'task', start: 20000, end: 50000 }] }
  const periods = workSegments(data)
  expect(periods.map(p => [p.start, p.end, p.state])).toEqual([[0, 10000, 'running'], [10000, 50000, 'heartbeat']])
})
