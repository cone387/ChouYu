import { afterEach, expect, it } from 'vitest'
import { AgentStore } from './store'
import { contactHome } from './home'
import { cardHighlights } from '../../shared/contact-home'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
const stores: AgentStore[] = []
afterEach(() => stores.splice(0).forEach(store => store.close()))
it('projects real pending decisions independently of read notices and pins the latest saved version', () => {
  const store = new AgentStore(':memory:'); stores.push(store)
  store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: 'Write', enabled: false })
  store.remember('alice', 'PRIVATE_HOME_MEMORY')
  const topic = store.topics.create('alice', { title: 'Story', goal: 'Write a story', constraints: '' }, 'user')
  for (let version = 1; version <= 2; version++) {
    const runId = store.createRun('alice', '', Date.now(), topic.id)
    store.finish(runId, { runId, title: 'Story', body: `Real prose ${version}`, nextStep: 'Continue', evidence: [], createdAt: Date.now() }, [], { status: 'researching', judgement: 'Saved', nextStep: 'Continue', reason: 'Saved', openQuestions: '' })
  }
  const runId = store.createRun('alice', '', Date.now(), topic.id)
  store.wait(runId, 'Which ending do you want?')
  const home = contactHome(store, 'alice')
  expect(home.pending).toHaveLength(1)
  expect(home.recentDeliveries[0].ref.version).toBe(2)
  expect(JSON.stringify(home)).not.toContain('PRIVATE_HOME_MEMORY')
  for (const notice of store.notices.pending('alice')) store.notices.ack('alice', notice.id)
  expect(contactHome(store, 'alice').pending).toHaveLength(1)
  expect(home.tasks.some(task => task.running)).toBe(false)
  expect(cardHighlights(home).pending).toContain('Which ending')
  expect(cardHighlights(home).sources?.pending).toEqual({ characterId: 'alice', interactionId: home.pending[0].id, topicId: topic.id })
  expect(cardHighlights(home).sources?.delivery).toEqual(home.recentDeliveries[0].ref)
  const snapshot = cardHighlights(home)
  home.recentDeliveries[0].ref.version = 99
  expect(snapshot.sources?.delivery?.version).toBe(2)
})
it('does not manufacture statistics or busy status for empty contact data', () => {
  expect(cardHighlights({ pending: [], recentDeliveries: [], tasks: [], measuredAt: 1 })).toEqual({})
})
