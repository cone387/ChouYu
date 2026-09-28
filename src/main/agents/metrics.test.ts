import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentStore } from './store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'

describe('task usage metrics', () => {
  it('aggregates all rounds, isolates tasks, preserves unknown usage and migrates existing records', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chouyu-metrics-'))
    let store = new AgentStore(join(dir, 'agents.db'))
    try {
      store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: 'A', dailyCalls: 48 }, 1000)
      store.save('bob', { ...DEFAULT_AGENT_SETTINGS, goal: 'B' }, 1000)
      const topic = store.overview('alice').topics[0]
      const other = store.overview('bob').topics[0]
      for (let i = 0; i < 32; i++) {
        const run = store.createRun('alice', '', 2000 + i * 1000)
        store.charge(run, 2000 + i * 1000)
        if (i < 30) store.recordCallMetadata(store.latestCallId(run)!, { model: 'model-a', usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 } })
        store.setStatus(run, 'completed', 2500 + i * 1000)
      }
      const bob = store.createRun('bob', '', 10000)
      store.charge(bob, 10000)
      store.recordCallMetadata(store.latestCallId(bob)!, { usage: { totalTokens: 999 } })
      store.createTopic('alice', { title: '另一任务', goal: '独立目标', constraints: '' })
      const anotherTopic = store.overview('alice').topics.find(item => item.id !== topic.id)!
      const anotherRun = store.createRun('alice', '', 39000, anotherTopic.id)
      store.charge(anotherRun, 39000)
      store.recordCallMetadata(store.latestCallId(anotherRun)!, { model: 'other-model', usage: { totalTokens: 9999 } })
      store.setStatus(anotherRun, 'failed', 39500)
      const metric = store.overview('alice', 40000).topicMetrics![topic.id]
      expect(store.overview('alice').runs).toHaveLength(30)
      expect(metric).toMatchObject({ runs: 32, calls: 32, elapsedMs: 16000, activeRuns: 0, totalTokens: 3600, inputTokens: 3000, outputTokens: 600, totalReported: 30, models: ['model-a'] })
      expect(store.overview('alice').topicMetrics![other.id]).toBeUndefined()
      expect(store.overview('bob', 14000).topicMetrics![other.id]).toMatchObject({ calls: 1, elapsedMs: 4000, activeRuns: 1, totalTokens: 999, inputReported: 0 })
      store.close(); store = new AgentStore(join(dir, 'agents.db'))
      expect(store.overview('alice', 40000).topicMetrics![topic.id]).toEqual(metric)
      store.db.exec('ALTER TABLE calls DROP COLUMN metadata; PRAGMA user_version=6;')
      store.close(); store = new AgentStore(join(dir, 'agents.db'))
      expect(store.overview('alice').topicMetrics![topic.id]).toMatchObject({ runs: 32, calls: 32, totalReported: 0, totalTokens: 0 })
    } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
  })
})
