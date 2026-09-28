import { expect, it } from 'vitest'
import { AgentStore } from './store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'

it('summarizes active tasks, all retained usage and current memories per contact', () => {
  const store = new AgentStore(':memory:')
  try {
    expect(store.summary('new')).toEqual({ tasks: 0, activeTasks: 0, calls: 0, reported: 0, tokens: 0, memories: 0 })
    store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: 'A' })
    store.save('bob', { ...DEFAULT_AGENT_SETTINGS, goal: 'B' })
    expect(store.summary('alice').activeTasks).toBe(0)
    const run = store.createRun('alice', '')
    store.charge(run)
    expect(store.summary('alice')).toMatchObject({ tasks: 1, activeTasks: 1, calls: 1, reported: 0, tokens: 0 })
    store.recordCallMetadata(store.latestCallId(run)!, { usage: { totalTokens: 1234 } })
    store.setStatus(run, 'failed')
    for (const status of ['researching', 'needs_evidence', 'paused', 'completed', 'abandoned'] as const) {
      const topic = store.topics.create('alice', { title: status, goal: status, constraints: '' }, 'fixture')
      store.db.prepare('UPDATE topics SET value=? WHERE id=?').run(JSON.stringify({ ...topic, status }), topic.id)
    }
    store.remember('alice', 'one')
    store.remember('alice', 'two')
    store.remember('bob', 'private')
    const other = store.createRun('bob', '')
    store.charge(other)
    store.recordCallMetadata(store.latestCallId(other)!, { usage: { totalTokens: 9999 } })
    expect(store.summary('alice')).toEqual({ tasks: 6, activeTasks: 2, calls: 1, reported: 1, tokens: 1234, memories: 2 })
    store.forget('alice', store.memories('alice')[0].id)
    expect(store.summary('alice').memories).toBe(1)
    expect(store.summary('bob')).toMatchObject({ tasks: 1, activeTasks: 1, tokens: 9999, memories: 1 })
  } finally { store.close() }
})
