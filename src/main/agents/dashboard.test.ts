import { describe, expect, it } from 'vitest'
import { AgentStore } from './store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { AgentService } from './service'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

describe('contacts dashboard', () => {
  it('serves the global dashboard without requiring a single contact identity', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'chouyu-dashboard-'))
    const service = new AgentService(directory, () => {})
    try {
      const data = await service.request('dashboard', '', [['new-contact']])
      expect(data.contacts['new-contact'].summary.tasks).toBe(0)
      await expect(service.request('dashboard', '', [null])).rejects.toThrow('联系人列表无效')
    } finally { await service.close(); rmSync(directory, { recursive: true, force: true }) }
  })
  it('aggregates all contacts and rounds with accurate usage and event ownership', () => {
    const store = new AgentStore(':memory:')
    try {
      for (const id of ['alice', 'bob', 'excluded']) store.save(id, { ...DEFAULT_AGENT_SETTINGS, goal: `${id} task` })
      const first = store.createRun('alice', '')
      store.charge(first)
      store.recordCallMetadata(store.latestCallId(first)!, { usage: { totalTokens: 12000 } })
      store.event(first, 'analysis', 'first round')
      store.setStatus(first, 'completed')
      const second = store.createRun('alice', '')
      store.charge(second)
      store.event(second, 'analysis', 'second round')
      const bob = store.createRun('bob', '')
      store.event(bob, 'waiting', 'question')
      store.setStatus(bob, 'waiting')
      const excluded = store.createRun('excluded', '')
      store.event(excluded, 'analysis', 'must not appear')
      const data = store.dashboard(['alice', 'bob', 'new-contact'])
      expect(data.contacts.alice.summary).toMatchObject({ tasks: 1, calls: 2, reported: 1, tokens: 12000 })
      expect(data.contacts.bob.run?.status).toBe('waiting')
      expect(data.contacts.alice.latestActivity?.text).toBe('second round')
      expect(data.contacts['new-contact'].summary.tasks).toBe(0)
      expect(data.events.some(e => e.runId === first && e.characterId === 'alice' && e.topicTitle === 'alice task')).toBe(true)
      expect(data.events.some(e => e.runId === second)).toBe(true)
      expect(data.events.every(e => e.characterId !== 'excluded')).toBe(true)
      store.remove('bob')
      expect(store.dashboard(['alice']).events.every(e => e.characterId === 'alice')).toBe(true)
    } finally { store.close() }
  })
  it('bounds the log window and returns stable chronological event order', () => {
    const store = new AgentStore(':memory:')
    try {
      store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: 'A' })
      const run = store.createRun('alice', '')
      for (let i = 0; i < 150; i++) store.event(run, 'analysis', `event-${i}`)
      const data = store.dashboard(['alice'])
      expect(data.events).toHaveLength(120)
      expect(data.events[0].text).toBe('event-30')
      expect(data.events.at(-1)?.text).toBe('event-149')
      expect(store.dashboard([])).toEqual({ contacts: {}, events: [] })
    } finally { store.close() }
  })
})
