import { describe, expect, it } from 'vitest'
import { AgentStore } from './store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { analyticsRange } from './analytics'

const at = (day: string, time: string) => +new Date(`${day}T${time}`)
describe('daily contact activity and consumption', () => {
  it('keeps the last work time separate from heartbeat and newly queued work', () => {
    const store = new AgentStore(':memory:')
    try {
      store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: 'A', enabled: true }, 1000)
      expect(store.dashboard(['alice']).contacts.alice.lastWorkedAt).toBeUndefined()
      const run = store.createRun('alice', '', 2000)
      store.event(run, 'execution-start', 'start', 3000)
      store.setStatus(run, 'completed', 4000)
      store.event(run, 'completed', 'done', 4000)
      store.event(run, 'heartbeat', 'idle', 5000)
      store.createRun('alice', '', 6000)
      expect(store.dashboard(['alice']).contacts.alice.lastWorkedAt).toBe(4000)
      expect(store.dashboard(['bob']).contacts.bob.lastWorkedAt).toBeUndefined()
    } finally { store.close() }
  })
  it('splits execution across midnight, excludes waits, attributes returned tokens and isolates contacts', () => {
    const store = new AgentStore(':memory:')
    try {
      const before = at('2026-09-27', '23:50:00'), midnight = at('2026-09-28', '00:00:00')
      store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: 'A' }, before)
      store.save('bob', { ...DEFAULT_AGENT_SETTINGS, goal: 'B' }, before)
      const run = store.createRun('alice', '', before)
      store.setStatus(run, 'running', before + 60000)
      store.charge(run, before + 60000)
      store.recordCallMetadata(store.latestCallId(run)!, { usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100 } }, midnight + 60000)
      store.event(run, 'waiting', 'question', midnight + 120000)
      store.event(run, 'answer', 'answer', midnight + 600000)
      store.event(run, 'execution-start', 'resume', midnight + 660000)
      store.setStatus(run, 'failed', midnight + 900000)
      const bob = store.createRun('bob', '', midnight)
      store.charge(bob, midnight)
      store.recordCallMetadata(store.latestCallId(bob)!, { usage: { totalTokens: 9999 } }, midnight + 60000)
      store.db.prepare('UPDATE runs SET summary=? WHERE id=?').run('Alice round output', run)
      store.db.prepare('UPDATE runs SET summary=? WHERE id=?').run('Bob private output', bob)
      expect(store.analytics('alice', { date: '2026-09-28', days: 1, timeline: true }, midnight + 3600000).runSummaries).toEqual([{ runId: run, title: 'Alice round output' }])
      const today = store.analytics('alice', { date: '2026-09-28', days: 1 }, midnight + 3600000)
      expect(today.totals).toMatchObject({ executionMs: 360000, waitingMs: 540000, tokens: 100, reported: 1, samples: 1, calls: 0, failures: 1 })
      expect(today.runSummaries).toBeUndefined()
      expect(today.buckets.reduce((sum, b) => sum + b.executionMs, 0)).toBe(today.totals.executionMs)
      expect(today.spans.every(s => s.start >= midnight && !s.approximate)).toBe(true)
      const yesterday = store.analytics('alice', { date: '2026-09-27', days: 1 }, midnight + 3600000)
      expect(yesterday.totals).toMatchObject({ calls: 1, tokens: 0, executionMs: 540000, waitingMs: 60000 })
      const week = store.analytics('alice', { date: '2026-09-28', days: 7 }, midnight + 3600000)
      expect(week.buckets).toHaveLength(7)
      expect(week.totals.tokens).toBe(100)
      expect(week.totals.executionMs).toBe(900000)
      expect(() => store.analytics('bob', { date: '2026-09-28', days: 1, topicId: store.overview('alice').topics[0].id })).toThrow()
    } finally { store.close() }
  })
  it('keeps unknown usage distinct, includes all rounds beyond overview limit and filters tasks', () => {
    const store = new AgentStore(':memory:')
    try {
      const start = at('2026-09-28', '00:00:00')
      store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: 'A', dailyCalls: 100 }, start)
      const first = store.overview('alice').topics[0]
      for (let i = 0; i < 35; i++) {
        const run = store.createRun('alice', '', start + i * 1000)
        store.event(run, 'planning', '', start + i * 1000)
        store.charge(run, start + i * 1000)
        if (i % 2) store.db.prepare('UPDATE calls SET metadata=? WHERE run_id=?').run(JSON.stringify({ usage: { totalTokens: 100 } }), run)
        store.setStatus(run, 'completed', start + i * 1000 + 500)
      }
      store.createTopic('alice', { title: 'Other', goal: 'Other', constraints: '' })
      const second = store.overview('alice').topics.find(t => t.id !== first.id)!
      const secondRun = store.createRun('alice', '', start + 60000, second.id)
      store.setStatus(secondRun, 'running', start + 61000)
      store.charge(secondRun, start + 61000)
      const query = { date: '2026-09-28', days: 1 as const, topicId: first.id }
      const data = store.analytics('alice', query, start + 120000)
      expect(data.totals).toMatchObject({ calls: 35, samples: 35, reported: 17, tokens: 1700, executionMs: 17500 })
      expect(data.tasks).toHaveLength(1)
      expect(data.legacyCalls).toBe(35)
      expect(data.spans.every(s => s.approximate)).toBe(true)
      expect(store.analytics('alice', { ...query, topicId: second.id }, start + 120000).totals.executionMs).toBe(59000)
      expect(store.analytics('alice', { date: '2026-09-26', days: 1 }, start).spans).toEqual([])
    } finally { store.close() }
  })
  it('rejects invalid calendar dates and excessive ranges', () => {
    expect(() => analyticsRange({ date: '2026-02-30', days: 1 })).toThrow()
    expect(() => analyticsRange({ date: '2026-09-28', days: 365 as 1 })).toThrow()
    expect(analyticsRange({ date: '2026-09-28', days: 30 }).boundaries).toHaveLength(31)
  })
  it('records contiguous idle heartbeats without log spam, excludes gaps and scopes timeline data', () => {
    const store = new AgentStore(':memory:')
    try {
      const start = at('2026-09-28', '10:00:00')
      store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: 'A', enabled: true }, start)
      store.save('bob', { ...DEFAULT_AGENT_SETTINGS, goal: 'B', enabled: true }, start)
      store.recordHeartbeats(start); store.recordHeartbeats(start + 15000)
      store.recordHeartbeats(start + 120000); store.recordHeartbeats(start + 135000)
      const run = store.createRun('alice', '', start + 140000)
      store.event(run, 'planning', 'Alice private log', start + 141000)
      store.recordHeartbeats(start + 150000)
      const topicId = store.overview('alice').topics[0].id
      const data = store.analytics('alice', { date: '2026-09-28', days: 1, topicId, timeline: true }, start + 160000)
      expect(data.heartbeats?.map(h => [h.start, h.end])).toEqual([[start, start + 15000], [start + 120000, start + 135000]])
      expect(data.logs?.some(log => log.text === 'Alice private log')).toBe(true)
      expect(data.logs?.some(log => log.kind === 'heartbeat')).toBe(false)
      expect(store.analytics('bob', { date: '2026-09-28', days: 1, timeline: true }, start + 160000).logs).toEqual([])
      store.deleteTopic('alice', topicId, store.topics.get('alice', topicId).revision)
      expect(store.analytics('alice', { date: '2026-09-28', days: 1, timeline: true }, start + 160000).heartbeats).toEqual([])
    } finally { store.close() }
  })
})
