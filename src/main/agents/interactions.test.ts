import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentStore } from './store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
const cleanups: (() => void)[] = []
afterEach(() => { for (const close of cleanups.splice(0).reverse()) close() })
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'contact-interactions-')), path = join(dir, 'agents.db')
  cleanups.push(() => rmSync(dir, { force: true, recursive: true }))
  const store = new AgentStore(path); cleanups.push(() => store.close())
  store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: '持续写作', enabled: true, dailyCalls: 100 })
  return { store, path }
}
function budgetCard(store: AgentStore) {
  const run = store.createRun('alice', '')
  store.allocateTaskBudget(run, { modelCalls: 3, reason: '起步预算' })
  store.charge(run); store.charge(run)
  store.finish(run, { runId: run, title: '第一节', body: '已保存正文', nextStep: '继续', evidence: [], createdAt: Date.now() }, [],
    { judgement: '已写第一节', reason: '实际交付', nextStep: '继续', openQuestions: '', status: 'researching' })
  const id = store.notices.pending('alice').find(n => n.purpose === 'resources')!.interactionId!
  return store.decisions.get('alice', id)
}
it('persists an actionable budget request, then atomically adjusts and queues exactly once across restart', () => {
  const { store, path } = fixture(), card = budgetCard(store)
  expect(card.budgets).toMatchObject([{ key: 'taskCalls', used: 2, limit: 3, needed: 2 }])
  const other = new AgentStore(path); cleanups.push(() => other.close())
  expect(other.decisions.get('alice', card.id)).toEqual(card)
  const result = other.decisions.submit('alice', card.id, { version: card.version, limits: { taskCalls: 10 } }, '')
  expect(result.status).toBe('resolved')
  expect(store.topics.get('alice', card.topicId).resourceBudget?.modelCalls).toBe(10)
  expect(store.overview('alice').runs.filter(r => r.status === 'queued')).toHaveLength(1)
  expect(store.decisions.submit('alice', card.id, { version: card.version, limits: { taskCalls: 900 } }, '')).toEqual(result)
  expect(store.topics.get('alice', card.topicId).resourceBudget?.modelCalls).toBe(10)
  expect(store.overview('alice').runs.filter(r => r.status === 'queued')).toHaveLength(1)
})
it('rejects foreign owners, stale cards and unsupported scope changes', () => {
  const { store } = fixture(), card = budgetCard(store)
  expect(() => store.decisions.get('bob', card.id)).toThrow('不属于')
  expect(() => store.decisions.submit('alice', card.id, { version: card.version, limits: { taskCalls: 10, dailyCalls: 900 } }, '')).toThrow('当前受限')
  const topic = store.topics.get('alice', card.topicId)
  store.changeTopic('alice', topic.id, topic.revision, { status: 'paused', reason: '用户明确暂停' })
  expect(store.decisions.get('alice', card.id).status).toBe('obsolete')
  expect(() => store.decisions.submit('alice', card.id, { version: card.version, limits: { taskCalls: 10 } }, '')).toThrow('失效')
  expect(store.topics.get('alice', card.topicId).resourceBudget?.modelCalls).toBe(3)
})
it('keeps deletion obsolete and never recreates the task from its card', () => {
  const { store } = fixture(), card = budgetCard(store)
  store.deleteTopic('alice', card.topicId, store.topics.get('alice', card.topicId).revision)
  expect(store.decisions.get('alice', card.id).status).toBe('obsolete')
  expect(() => store.decisions.submit('alice', card.id, { version: card.version, limits: { taskCalls: 10 } }, '')).toThrow()
})
it('rolls back limits and receipt when queuing fails', () => {
  const { store } = fixture(), card = budgetCard(store)
  store.db.exec("CREATE TRIGGER fail_queue BEFORE INSERT ON runs BEGIN SELECT RAISE(ABORT,'disk full fixture'); END")
  expect(() => store.decisions.submit('alice', card.id, { version: card.version, limits: { taskCalls: 10 } }, '')).toThrow('disk full')
  expect(store.decisions.get('alice', card.id).status).toBe('pending')
  expect(store.topics.get('alice', card.topicId).resourceBudget?.modelCalls).toBe(3)
  store.db.exec('DROP TRIGGER fail_queue')
  expect(store.decisions.submit('alice', card.id, { version: card.version, limits: { taskCalls: 10 } }, '').status).toBe('resolved')
})
it('collects all blocking limits and never partially raises one of them', () => {
  const { store } = fixture(), card = budgetCard(store)
  store.save('alice', { ...store.overview('alice').settings, dailyCalls: 3 }, Date.now(), false)
  const refreshed = store.decisions.get('alice', card.id)
  expect(refreshed.budgets.map(f => f.key)).toEqual(['taskCalls', 'dailyCalls'])
  expect(() => store.decisions.submit('alice', card.id, { version: card.version, limits: { taskCalls: 10 } }, '')).toThrow('已变化')
  expect(() => store.decisions.submit('alice', card.id, { version: refreshed.version, limits: { taskCalls: 10 } }, '')).toThrow('每日调用')
  expect(store.topics.get('alice', card.topicId).resourceBudget?.modelCalls).toBe(3)
  expect(store.decisions.submit('alice', card.id, { version: refreshed.version, limits: { taskCalls: 10, dailyCalls: 10 } }, '').status).toBe('resolved')
})
it('answers the original checkpoint once, recognizes external answers and does not confuse a subsequent question', () => {
  const { store } = fixture(), run = store.createRun('alice', '')
  store.wait(run, '读者年龄？')
  const firstId = store.notices.pending('alice').find(n => n.kind === 'question')!.interactionId!
  const first = store.decisions.get('alice', firstId)
  expect(() => store.decisions.submit('alice', firstId, { version: first.version, answer: '  ' }, '')).toThrow()
  store.answer('alice', run, '成年人')
  expect(store.decisions.get('alice', firstId).status).toBe('resolved')
  store.wait(run, '篇幅要求？')
  const id = store.notices.pending('alice').find(n => n.kind === 'question')!.interactionId!
  const card = store.decisions.get('alice', id)
  expect(card.status).toBe('pending')
  store.decisions.submit('alice', id, { version: card.version, answer: '两千字左右' }, '')
  store.decisions.submit('alice', id, { version: card.version, answer: '另一份回复' }, '')
  expect(store.getRun(run)?.answer).toBe('两千字左右')
  expect(store.getRun(run)?.status).toBe('queued')
})
it('offers retry only after automatic retries stop, and restarts the same task once', () => {
  const { store } = fixture()
  for (let i = 0; i < 3; i++) {
    const run = store.createRun('alice', '')
    store.fail(run, '模型输出格式无效')
    const notice = store.notices.pending('alice').find(n => n.runId === run)!
    if (i < 2) expect(notice.interactionId).toBeUndefined()
    else {
      const card = store.decisions.get('alice', notice.interactionId!)
      store.decisions.submit('alice', card.id, { version: card.version }, '')
      expect(store.overview('alice').failures).toBe(0)
      expect(store.overview('alice').runs.find(r => r.status === 'queued')?.topicId).toBe(card.topicId)
    }
  }
})
it('resumes interrupted daily Token work without discarding its checkpoint', () => {
  const { store } = fixture()
  store.save('alice', { ...store.overview('alice').settings, dailyTokenLimit: 1 }, Date.now(), false)
  const run = store.createRun('alice', ''); const call = store.charge(run)
  const callId = store.latestCallId(run)!
  const reservation = store.tokens.reserve(run, callId, 'alice', store.getRun(run)!.topic_id, 'prompt', 1024)
  expect(reservation).toHaveProperty('error')
  store.fail(run, 'Token limit')
  const id = store.notices.pending('alice').find(n => n.purpose === 'resources')!.interactionId!
  const card = store.decisions.get('alice', id)
  expect(card.budgets.map(f => f.key)).toContain('dailyTokens')
  store.decisions.submit('alice', id, { version: card.version, limits: { dailyTokens: 20000 } }, '')
  expect(store.getRun(run)?.status).toBe('queued')
  expect(store.tokens.canResume(run, 'alice', store.getRun(run)!.topic_id)).toBe(true)
  expect(store.overview('alice').runs).toHaveLength(1)
})

it('upgrades only current legacy blockers once and leaves old message text intact', () => {
  const { store, path } = fixture(), card = budgetCard(store)
  store.db.prepare('DELETE FROM contact_interactions WHERE id=?').run(card.id)
  store.db.prepare("UPDATE notices SET value=json_remove(value,'$.interactionId'),state='sent' WHERE id=?").run(card.id)
  const original = (store.db.prepare('SELECT value FROM notices WHERE id=?').get(card.id) as { value: string }).value
  store.decisions.publishOutstanding('alice'); store.decisions.publishOutstanding('alice')
  const notices = store.notices.pending('alice').filter(n => n.interactionId)
  expect(notices).toHaveLength(1)
  expect(notices[0].interactionId).toBe(`${card.id}:interaction`)
  expect((store.db.prepare('SELECT value FROM notices WHERE id=?').get(card.id) as { value: string }).value).toBe(original)
  store.notices.ack('alice', notices[0].id)
  const reopened = new AgentStore(path); cleanups.push(() => reopened.close())
  reopened.decisions.publishOutstanding('alice')
  expect(reopened.notices.pending('alice').filter(n => n.interactionId)).toHaveLength(0)
})
it('creates a daily quota card before a queued round burns a model call', () => {
  const { store } = fixture(), run = store.createRun('alice', '')
  store.save('alice', { ...store.overview('alice').settings, dailyCalls: 2 }, Date.now(), false)
  store.charge(run)
  store.decisions.checkScheduledResources('alice'); store.decisions.checkScheduledResources('alice')
  const cards = store.decisions.pending('alice')
  expect(cards).toHaveLength(1)
  expect(cards[0].budgets).toMatchObject([{ key: 'dailyCalls', used: 1, needed: 2 }])
  store.decisions.submit('alice', cards[0].id, { version: cards[0].version, limits: { dailyCalls: 10 } }, '')
  expect(store.overview('alice').runs).toHaveLength(1)
  expect(store.getRun(run)?.status).toBe('queued')
  expect(store.callCount('alice')).toBe(1)
})

it('does not resurrect a cleared historical message during upgrade', () => {
  const { store } = fixture(), card = budgetCard(store)
  store.db.prepare('DELETE FROM contact_interactions WHERE id=?').run(card.id)
  store.db.prepare("UPDATE notices SET value=json_remove(value,'$.interactionId'),state='sent' WHERE id=?").run(card.id)
  store.decisions.publishOutstanding('alice', new Set())
  expect(store.decisions.pending('alice')).toHaveLength(0)
  expect(store.notices.pending('alice').some(n => n.interactionId)).toBe(false)
})
