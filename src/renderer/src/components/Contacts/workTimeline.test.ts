import { expect, it } from 'vitest'
import { emptyUsage, type AgentAnalytics } from '../../../../shared/agent-analytics'
import { workSegments, workTimelineRows, workTimelineBlocks } from './workTimeline'

it('summarizes steps into work periods, clips boundaries and leaves unrecorded gaps blank', () => {
  const data: AgentAnalytics = { start: 100, end: 1000, measuredAt: 800, totals: emptyUsage(), buckets: [], tasks: [], activity: [], legacyCalls: 0,
    spans: [{ runId: 'a', topicId: 'task', start: 50, end: 400, state: 'running', approximate: false }, { runId: 'b', topicId: 'task', start: 600, end: 900, state: 'waiting', approximate: true }],
    logs: [{ id: 1, runId: 'a', topicId: 'task', at: 200, text: '搜索资料', kind: 'search' }, { id: 2, runId: 'a', topicId: 'task', at: 300, text: '撰写结论\n细节', kind: 'drafting' }],
    heartbeats: [{ id: 1, topicId: 'task', start: 450, end: 500 }] }
  const segments = workSegments(data)
  expect(segments.map(s => [s.start, s.end])).toEqual([[100, 400], [450, 800]])
  expect(segments[0].text).toContain('搜索资料、撰写内容')
  expect(segments[1].state).toBe('heartbeat')
  expect(segments[1].text).toContain('休息')
  expect(segments[1].approximate).toBe(true)
})
it('preserves all rest in mixed half-hour blocks instead of letting a brief task occupy the whole block', () => {
  const hour = 3600000
  const data: AgentAnalytics = { start: 0, end: 24 * hour, measuredAt: 4 * hour, totals: emptyUsage(), buckets: [], tasks: [], activity: [], legacyCalls: 0,
    spans: [{ runId: 'one', topicId: 'a', start: hour + 1000, end: hour + 3000, state: 'running', approximate: false },
      { runId: 'two', topicId: 'a', start: hour * 1.5 + 1000, end: hour * 1.5 + 4000, state: 'running', approximate: false }],
    heartbeats: [{ id: 1, topicId: 'a', start: hour, end: 3 * hour }] }
  const blocks = workTimelineBlocks(data)
  expect(blocks.filter(b => b.running)).toHaveLength(2)
  expect(blocks.filter(b => !b.running)).toHaveLength(3)
  expect(blocks.reduce((sum, b) => sum + b.executionMs, 0)).toBe(5000)
  expect(blocks.reduce((sum, b) => sum + b.restMs, 0)).toBe(2 * hour - 5000)
  for (const block of blocks) expect(block.end - block.start).toBe(block.executionMs + block.restMs)
  expect(blocks.every((block, index) => !index || block.start >= blocks[index - 1].end)).toBe(true)
})
it('does not turn missing records or future time into rest', () => {
  const data: AgentAnalytics = { start: 0, end: 86400000, measuredAt: 120000, totals: emptyUsage(), buckets: [], tasks: [], activity: [], legacyCalls: 0,
    spans: [{ runId: 'one', topicId: 'a', start: 90000, end: 91000, state: 'running', approximate: false }], heartbeats: [] }
  const blocks = workTimelineBlocks(data)
  expect(blocks.map(b => [b.start, b.end, b.executionMs, b.restMs])).toEqual([[90000, 91000, 1000, 0]])
})
it('keeps repeated task runs in one row and merges 14:15–14:17 / 14:17–14:31 heartbeats', () => {
  const minute = 60000
  const data: AgentAnalytics = { start: 0, end: 86400000, measuredAt: 86400000, totals: emptyUsage(), buckets: [], tasks: [], activity: [], legacyCalls: 0,
    spans: [{ runId: 'first', topicId: 'idea', start: 60000, end: 120000, state: 'running', approximate: false }, { runId: 'second', topicId: 'idea', start: 300000, end: 360000, state: 'running', approximate: false }],
    heartbeats: [{ id: 1, topicId: 'idea', start: 855 * minute, end: 857 * minute }, { id: 2, topicId: 'idea', start: 857 * minute + 15000, end: 871 * minute }] }
  const rows = workTimelineRows(data)
  expect(rows).toHaveLength(2)
  expect(rows[0].ranges).toHaveLength(2)
  expect(rows[1].text).toBe('心跳')
  expect(rows[1].ranges.map(r => [r.start, r.end])).toEqual([[855 * minute, 871 * minute]])
})
it('keeps dispatch as rest and combines adjoining rest periods', () => {
  const data: AgentAnalytics = { start: 0, end: 100000, measuredAt: 90000, totals: emptyUsage(), buckets: [], tasks: [], activity: [], legacyCalls: 0,
    spans: [{ runId: 'a', topicId: 'task', start: 0, end: 100, state: 'queued', approximate: false }, { runId: 'a', topicId: 'task', start: 100, end: 10000, state: 'running', approximate: false }, { runId: 'a', topicId: 'task', start: 10000, end: 20000, state: 'waiting', approximate: false }],
    heartbeats: [{ id: 1, topicId: 'task', start: 20000, end: 50000 }] }
  const periods = workSegments(data)
  expect(periods.map(p => [p.start, p.end, p.state])).toEqual([[0, 100, 'heartbeat'], [100, 10000, 'running'], [10000, 50000, 'heartbeat']])
})
it('partitions stale waits, overlapping runs and heartbeat into mutually exclusive states', () => {
  const data: AgentAnalytics = { start: 0, end: 1000000, measuredAt: 900000, totals: emptyUsage(), buckets: [], tasks: [], activity: [], legacyCalls: 0,
    spans: [{ runId: 'old', topicId: 'a', start: 0, end: 900000, state: 'waiting', approximate: false },
      { runId: 'a1', topicId: 'a', start: 120000, end: 600000, state: 'running', approximate: false },
      { runId: 'b1', topicId: 'b', start: 240000, end: 360000, state: 'running', approximate: false }],
    heartbeats: [{ id: 1, topicId: 'a', start: 60000, end: 700000 }] }
  const periods = workSegments(data)
  expect(periods.map(p => [p.start, p.end, p.state, p.state === 'running' ? p.topicId : null])).toEqual([
    [0, 120000, 'heartbeat', null], [120000, 240000, 'running', 'a'], [240000, 360000, 'running', 'b'],
    [360000, 600000, 'running', 'a'], [600000, 900000, 'heartbeat', null]
  ])
  const plotted = workTimelineRows(data).flatMap(row => row.ranges).sort((a, b) => a.start - b.start)
  for (let index = 1; index < plotted.length; index++) expect(plotted[index].start).toBeGreaterThanOrEqual(plotted[index - 1].end)
  expect(plotted.reduce((sum, span) => sum + span.end - span.start, 0)).toBe(900000)
})
