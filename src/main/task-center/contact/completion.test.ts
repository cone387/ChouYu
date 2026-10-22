import { expect, it } from 'vitest'
import { ContactTaskStore } from '../contact-store'
import { ContactCompletion } from './completion'
import { DEFAULT_AGENT_SETTINGS, type AgentTopicProgress } from '../../../shared/agents'
import type { DeliveryUpdate } from '../../../shared/agent-delivery'

const progress: AgentTopicProgress = { status: 'researching', judgement: '已有正文', reason: '继续核对', nextStep: '下一节', openQuestions: '' }
const delivery: DeliveryUpdate = { completionCriteria: '保存正文', summary: '第一节', stages: [{ id: 'one', title: '正文', status: 'active' }], section: { id: 'one', title: '第一节', body: '这是实际保存的正文。' } }

it.each(['reports', 'delivery_blocks', 'delivery_block_references', 'delivery_versions', 'topics', 'notices'])('rolls back the entire completion when %s fails, then retries once', table => {
  const store = new ContactTaskStore(':memory:')
  try {
    expect(store.completion).toBeInstanceOf(ContactCompletion)
    store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: '持续写作', enabled: false, notifyProgress: true })
    const before = store.overview('alice').topics[0], run = store.createRun('alice', '')
    const report = { runId: run, title: '第一节', body: '已保存正文', nextStep: '下一节', createdAt: Date.now(), evidence: [] }
    const eventsBefore = store.detail('alice', run).events.length
    store.db.exec(`CREATE TRIGGER fixture_failure BEFORE ${table === 'topics' ? 'UPDATE' : 'INSERT'} ON ${table} BEGIN SELECT RAISE(ABORT,'fixture completion failure'); END`)
    expect(() => store.finish(run, report, [], progress, delivery)).toThrow('fixture completion failure')
    expect(store.detail('alice', run).events).toHaveLength(eventsBefore)
    expect(store.getRun(run)?.status).toBe('queued')
    expect(store.topics.get('alice', before.id)).toEqual(before)
    expect(store.deliveries.get(before.id)).toBeNull()
    expect(store.notices.pending('alice')).toEqual([])
    expect(store.db.prepare('SELECT * FROM reports').all()).toEqual([])
    expect(store.db.prepare('SELECT * FROM delivery_blocks').all()).toEqual([])
    expect(store.db.prepare('SELECT * FROM delivery_block_references').all()).toEqual([])
    store.db.exec('DROP TRIGGER fixture_failure')
    store.finish(run, report, [], progress, delivery)
    store.finish(run, report, [], progress, delivery)
    expect(store.getRun(run)?.status).toBe('completed')
    expect(store.deliveries.get(before.id)?.version).toBe(1)
    expect(store.notices.pending('alice')).toHaveLength(1)
  } finally { store.close() }
})

it('recovers interrupted rounds without duplicating them and shares call reservations with the facade', () => {
  const store = new ContactTaskStore(':memory:')
  try {
    store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: 'Research', dailyCalls: 2 })
    const run = store.createRun('alice', '')
    expect(store.callBudget.reserveRunCalls(run)).toBe(true)
    expect(store.reserveRunCalls(run)).toBe(false)
    store.releaseRunCalls(run)
    expect(store.callBudget.reserveRunCalls(run)).toBe(true)
    store.db.prepare("UPDATE runs SET status='running' WHERE id=?").run(run)
    store.recover(); store.recover()
    expect(store.overview('alice').runs.map(r => r.id)).toEqual([run])
  } finally { store.close() }
})
