import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContactTaskStore } from '../task-center/contact-store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
const cleanups: (() => void)[] = []
afterEach(() => { for (const close of cleanups.splice(0).reverse()) close() })
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'contact-interactions-')), path = join(dir, 'agents.db')
  cleanups.push(() => rmSync(dir, { force: true, recursive: true }))
  const store = new ContactTaskStore(path); cleanups.push(() => store.close())
  store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: '持续写作', enabled: true, dailyCalls: 100 })
  return { store, path }
}
function budgetCard(store: ContactTaskStore) {
  const run = store.createRun('alice', '')
  store.allocateTaskBudget(run, { modelCalls: 3, reason: '起步预算' })
  store.charge(run); store.charge(run)
  store.finish(run, { runId: run, title: '第一节', body: '已保存正文', nextStep: '继续', evidence: [], createdAt: Date.now() }, [],
    { judgement: '已写第一节', reason: '实际交付', nextStep: '继续', openQuestions: '', status: 'researching' })
  const id = store.notices.pending('alice').find(n => n.purpose === 'resources')!.interactionId!
  const card = store.decisions.get('alice', id)
  if (card.kind !== 'budget') throw new Error('Expected a task budget interaction')
  return card
}
it('states the failure impact and recovery separately and follows newer work without stale retry time', () => {
  const { store } = fixture(), run = store.createRun('alice', '')
  store.fail(run, '资料不在本轮目录快照内，请按本轮提供的版本读取。')
  const card = store.decisions.pending('alice')[0]
  expect(card.impact).toContain('还没有已保存的正文')
  expect(card.recoveryMessage).toContain('自动重试')
  expect(card.recoveryMessage).not.toContain('仍受工作时间和额度限制')
  const notice = store.notices.pending('alice').find(n => n.runId === run)!
  expect(notice.content).toContain(card.failure!.message)
  expect(notice.content).toContain(card.recoveryMessage!)
  expect(notice.content).not.toContain('已有成果保留')
  const newer = store.createRun('alice', '')
  expect(store.decisions.get('alice', card.id)).toMatchObject({ status: 'obsolete', currentState: 'queued' })
  store.setStatus(newer, 'running')
  const running = store.decisions.get('alice', card.id)
  expect(running.currentState).toBe('running')
  expect(running.result).toContain('正在重新尝试')
  expect(running.automaticRetryAt).toBeUndefined()
  store.fail(newer, 'API error 401')
  expect(store.decisions.get('alice', card.id)).toMatchObject({ currentState: 'failed' })
  expect(store.decisions.get('alice', card.id).result).toContain('模型服务')
})
it('persists failure and an honest notice even when an older delivery body is corrupt', () => {
  const { store } = fixture(), prior = store.createRun('alice', '')
  store.finish(prior, { runId: prior, title: '第一节', body: '此前已保存正文', nextStep: '继续', evidence: [], createdAt: Date.now() }, [],
    { judgement: '已写第一节', reason: '实际交付', nextStep: '继续', openQuestions: '', status: 'researching' })
  const run = store.createRun('alice', '')
  store.setStatus(run, 'running')
  store.db.prepare('UPDATE delivery_blocks SET body=?').run('corrupt body')
  expect(() => store.fail(run, '成果正文块损坏，无法读取此版本。')).not.toThrow()
  expect(store.getRun(run)).toMatchObject({ status: 'failed', error: '成果正文块损坏，无法读取此版本。' })
  const card = store.decisions.pending('alice').find(card => card.runId === run)!
  expect(card.impact).toContain('无法核实')
  expect(card.impact).not.toContain('仍可在任务中查看')
  expect(card.impact).not.toContain('还没有已保存')
  expect(store.notices.pending('alice').find(notice => notice.runId === run)?.content).toContain('无法核实')
  expect(store.db.prepare('SELECT body FROM delivery_blocks').all()).toEqual([{ body: 'corrupt body' }])
})

it('keeps failed-attempt impact and original notification immutable when a later delivery succeeds', () => {
  const { store } = fixture(), run = store.createRun('alice', '')
  store.fail(run, '本轮分段恢复次数已用完')
  const card = store.decisions.pending('alice')[0], notice = store.notices.pending('alice').find(n => n.runId === run)!
  const next = store.createRun('alice', '')
  store.finish(next, { runId: next, title: '已恢复', body: '实际正文', nextStep: '继续', evidence: [], createdAt: Date.now() }, [], { judgement: '实际交付', reason: '有正文', nextStep: '继续', openQuestions: '', status: 'researching' })
  const recovered = store.decisions.get('alice', card.id)
  expect(recovered.currentState).toBe('completed')
  expect(recovered.result).toContain('不代表整个任务已经结束')
  expect(recovered.impact).toBe(card.impact)
  expect(store.notices.pending('alice').find(n => n.id === notice.id)?.content).toBe(notice.content)
})
it('explains disabled automatic work, a real work-hours gate, and three failed attempts', () => {
  const { store } = fixture()
  store.save('alice', { ...store.overview('alice').settings, enabled: false })
  const run = store.createRun('alice', '')
  store.fail(run, 'unknown failure')
  const card = store.decisions.pending('alice')[0]
  expect(card.recoveryMessage).toContain('按需')
  expect(card.automaticRetryAt).toBeUndefined()
  store.save('alice', { ...store.overview('alice').settings, enabled: true, workHours: { start: '00:00', end: '00:01' } })
  expect(store.decisions.get('alice', card.id).recoveryMessage).toContain('00:00–00:01')
  for (let i = 0; i < 2; i++) { const next = store.createRun('alice', ''); store.fail(next, 'unknown failure') }
  const stopped = store.decisions.pending('alice')[0]
  expect(stopped.recoveryMessage).toContain('连续失败 3 次')
  expect(stopped.automaticRetryAt).toBeUndefined()
})
it('persists an actionable budget request, then atomically adjusts and queues exactly once across restart', () => {
  const { store, path } = fixture(), card = budgetCard(store)
  expect(card.budgets).toMatchObject([{ key: 'taskCalls', used: 2, limit: 3, needed: 2 }])
  const other = new ContactTaskStore(path); cleanups.push(() => other.close())
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
it('offers actionable feedback on every failure, with the actual automatic retry time', () => {
  const { store } = fixture()
  for (let i = 0; i < 3; i++) {
    const run = store.createRun('alice', '')
    store.fail(run, '模型输出格式无效')
    const notice = store.notices.pending('alice').find(n => n.runId === run)!
    const card = store.decisions.get('alice', notice.interactionId!)
    expect(card.failure?.kind).toBe('format')
    if (i < 2) expect(card.automaticRetryAt).toBeGreaterThan(Date.now())
    else {
      expect(card.automaticRetryAt).toBeUndefined()
      store.decisions.submit('alice', card.id, { version: card.version }, '')
      expect(store.overview('alice').failures).toBe(0)
      expect(store.overview('alice').runs.find(r => r.status === 'queued')?.topicId).toBe(card.topicId)
    }
  }
})
it('lets the user retry the first failure once and expires the old card when automatic work has already resumed', () => {
  const { store } = fixture(), run = store.createRun('alice', '')
  store.fail(run, '工作计划 urls 必须为数组')
  const card = store.decisions.pending('alice')[0]
  expect(card).toMatchObject({ kind: 'retry', status: 'pending' })
  store.decisions.submit('alice', card.id, { version: card.version }, '')
  store.decisions.submit('alice', card.id, { version: card.version }, '')
  expect(store.overview('alice').runs).toHaveLength(2)
  const second = store.overview('alice').runs.find(r => r.id !== run)!
  store.fail(second.id, '网络超时')
  const current = store.decisions.pending('alice')[0]
  store.createRun('alice', '')
  expect(store.decisions.get('alice', current.id).status).toBe('obsolete')
})
it('shows exact non-sensitive diagnostics and hides credentials in the interactive explanation', () => {
  const { store } = fixture(), run = store.createRun('alice', '')
  store.fail(run, '工作计划 urls 必须为数组')
  expect(store.decisions.pending('alice')[0].failureDetail).toBe('工作计划 urls 必须为数组')
  const next = store.createRun('alice', '')
  store.fail(next, 'API error api_key=do-not-display-this-value')
  const detail = store.decisions.pending('alice')[0].failureDetail
  expect(detail).not.toContain('do-not-display-this-value')
  expect(detail).toContain('已隐藏')
})
it('refreshes a failure card after changing permissions and requires its latest version to retry', () => {
  const { store } = fixture(), run = store.createRun('alice', '')
  store.fail(run, '未授权读取联系人的共享成果。')
  const before = store.decisions.pending('alice')[0]
  store.save('alice', { ...store.overview('alice').settings, readContactDeliveries: true }, Date.now(), false)
  const after = store.decisions.get('alice', before.id)
  expect(after.status).toBe('pending')
  expect(after.version).not.toBe(before.version)
  expect(() => store.decisions.submit('alice', before.id, { version: before.version }, '')).toThrow('已变化')
  store.decisions.submit('alice', after.id, { version: after.version }, '')
  expect(store.overview('alice').runs.filter(r => r.status === 'queued')).toHaveLength(1)
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
  const reopened = new ContactTaskStore(path); cleanups.push(() => reopened.close())
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
it('retries failed presentation changes in their original scope, including paused tasks', () => {
  const { store } = fixture(), run = store.createRun('alice', '')
  store.finish(run, { runId: run, title: '第一节', body: '已保存正文', nextStep: '继续', evidence: [], createdAt: Date.now() }, [],
    { judgement: '已写第一节', reason: '实际交付', nextStep: '继续', openQuestions: '', status: 'researching' })
  const topicId = store.getRun(run)!.topic_id!
  let topic = store.topics.get('alice', topicId)
  store.changeTopic('alice', topicId, topic.revision, { status: 'paused', reason: '保留正文，仅调整阅读样式' })
  topic = store.topics.get('alice', topicId)
  const artifact = store.deliveries.get(topicId)!
  const revision = store.revisePresentation('alice', topicId, topic.revision, '行距改为两倍', '', artifact.version)
  store.fail(revision, 'API error 503')
  const notice = store.notices.pending('alice').find(n => n.runId === revision)!
  expect(notice.interactionId).toBeTruthy()
  const card = store.decisions.get('alice', notice.interactionId!)
  expect(card.status).toBe('pending')
  expect(card.automaticRetryAt).toBeUndefined()
  expect(card.failure?.action).toBe('重试本次样式修改')
  store.decisions.submit('alice', card.id, { version: card.version }, '')
  store.decisions.submit('alice', card.id, { version: card.version }, '')
  const queued = store.overview('alice').runs.filter(r => r.status === 'queued')
  expect(queued).toHaveLength(1)
  expect(JSON.parse(store.getRun(queued[0].id)!.input)).toMatchObject({ revisionScope: 'presentation', revisionBaseVersion: artifact.version, feedback: '行距改为两倍' })
  expect(store.deliveries.get(topicId)).toEqual(artifact)
  expect(store.topics.get('alice', topicId).status).toBe('paused')
})
