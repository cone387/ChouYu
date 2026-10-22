import { expect, it } from 'vitest'
import { ContactTaskStore } from '../contact-store'
import { ContactQueries } from './queries'
import { DEFAULT_AGENT_SETTINGS } from '../../../shared/agents'

it('uses the read-only query module for scoped projections without changing stored rows', () => {
  const store = new ContactTaskStore(':memory:')
  try {
    store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: 'Alice' })
    store.save('bob', { ...DEFAULT_AGENT_SETTINGS, goal: 'Bob' })
    expect(store.queries).toBeInstanceOf(ContactQueries)
    const before = store.db.prepare('SELECT total_changes() AS n').get()
    const first = store.queries.overview('alice')
    expect(first).toEqual(store.overview('alice'))
    expect(first.topics.every(t => t.characterId === 'alice')).toBe(true)
    expect(() => store.queries.detail('bob', store.createRun('alice', ''))).toThrow()
    const afterWrite = store.db.prepare('SELECT total_changes() AS n').get()
    expect(afterWrite).not.toEqual(before)
    store.queries.overview('alice'); store.queries.summary('alice'); store.queries.dashboard(['alice', 'bob'])
    expect(store.db.prepare('SELECT total_changes() AS n').get()).toEqual(afterWrite)
  } finally { store.close() }
})
