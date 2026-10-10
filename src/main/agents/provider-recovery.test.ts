import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentService } from './service'
import { dirname } from 'node:path'
import { AgentStore } from './store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { providerRecoveryDelay } from '../../shared/contact-failure'
const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); vi.useRealTimers() })
function fixture(error = 'API error 429: 余额不足或无可用资源包') {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 10, 10))
  const dir = mkdtempSync(join(tmpdir(), 'provider-recovery-')), path = join(dir, 'agents.db')
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const store = new AgentStore(path); cleanups.push(() => store.close())
  store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: '持续写作', enabled: true, dailyCalls: 100 })
  let run = ''
  for (let i = 0; i < 3; i++) { vi.setSystemTime(Date.now() + 1000); run = store.createRun('alice', ''); store.charge(run); store.fail(run, error) }
  return { store, path, run, topic: store.getRun(run)!.topic_id! }
}
it('restores old billing blocks across restart without resetting failures or bypassing backoff', () => {
  const { store, path, run, topic } = fixture()
  // Old builds recorded only a three-minute wait before permanently stopping.
  store.db.prepare('UPDATE profiles SET next_at=?').run(Date.now() + 180000)
  const reopened = new AgentStore(path); cleanups.push(() => reopened.close())
  const due = reopened.providerRecovery('alice')!.at
  expect(due).toBe(Date.now() + 15 * 60000)
  expect(reopened.nextScheduledTopic('alice', due - 1)).toBeUndefined()
  expect(reopened.nextScheduledTopic('alice', due)).toBe(topic)
  expect(reopened.profile('alice')!.failures).toBe(3)
  const card = reopened.decisions.pending('alice').find(c => c.runId === run)!
  expect(card.automaticRetryAt).toBe(due)
  vi.setSystemTime(due)
  const next = reopened.startScheduledTopic('alice', topic, '')
  expect(reopened.nextScheduledTopic('alice', due)).toBeUndefined()
  expect(reopened.decisions.get('alice', card.id).status).toBe('obsolete')
  reopened.finish(next, { runId: next, title: '恢复交付', body: '服务恢复后保存的真实正文', nextStep: '继续', evidence: [], createdAt: Date.now() }, [], { judgement: '已交稿', reason: '实际成果', nextStep: '继续', openQuestions: '', status: 'researching' })
  expect(reopened.profile('alice')!.failures).toBe(0)
  expect(reopened.overview('alice').reports).toHaveLength(1)
})
it('backs off recurring outages to 30 then 60 minutes without a hot loop', () => {
  const { store, topic } = fixture('API error 503')
  for (const minutes of [30, 60, 60]) {
    vi.setSystemTime(store.providerRecovery('alice')!.at)
    const run = store.startScheduledTopic('alice', topic, '')
    store.fail(run, 'API error 503')
    expect(store.providerRecovery('alice')!.at - Date.now()).toBe(minutes * 60000)
    expect(store.nextScheduledTopic('alice')).toBeUndefined()
  }
  expect(providerRecoveryDelay('429: rate limit', 3, 180)).toBe(180 * 60000)
})
it.each(['paused', 'completed', 'abandoned'] as const)('never restores a task changed to %s', status => {
  const { store, topic } = fixture(); const task = store.topics.get('alice', topic)
  store.changeTopic('alice', topic, task.revision, { status, reason: '用户决定' })
  expect(store.providerRecovery('alice')).toBeUndefined()
  expect(store.nextScheduledTopic('alice', Date.now() + 86400000)).toBeUndefined()
})
it('honors on-demand mode, daily calls and task calls during recovery', () => {
  const { store, topic } = fixture(); const due = store.providerRecovery('alice')!.at
  store.save('alice', { ...store.overview('alice').settings, enabled: false }, Date.now(), false)
  expect(store.nextScheduledTopic('alice', due)).toBeUndefined()
  store.save('alice', { ...store.overview('alice').settings, enabled: true, dailyCalls: 3 }, Date.now(), false)
  expect(store.nextScheduledTopic('alice', due)).toBeUndefined()
  store.save('alice', { ...store.overview('alice').settings, dailyCalls: 100 }, Date.now(), false)
  const task = store.topics.get('alice', topic)
  store.topics.budget('alice', topic, task.revision, { modelCalls: 3, reason: '用户上限' })
  expect(store.nextScheduledTopic('alice', due)).toBeUndefined()
})
it.each(['成果字段校验失败', 'API error 401: invalid api key', 'unexpected failure'])('keeps non-transient failure stopped: %s', error => {
  const { store } = fixture(error)
  expect(store.providerRecovery('alice')).toBeUndefined()
  expect(store.nextScheduledTopic('alice', Date.now() + 86400000)).toBeUndefined()
})

it('restarts the real scheduler after an outage and saves recovered output without manual retry', async () => {
  const { store, path } = fixture()
  vi.setSystemTime(store.providerRecovery('alice')!.at)
  const model = vi.fn(async (prompt: string) => prompt.startsWith('为联系人')
    ? JSON.stringify({ action: 'write', reason: '写正文', query: '', urls: [], checkAfterMinutes: 180 })
    : JSON.stringify({ title: '恢复后的成果', body: '已经保存的正文。', nextStep: '', memories: [], question: '', progress: { judgement: '完成', openQuestions: '', nextStep: '', reason: '已保存', status: 'completed' } }))
  const service = new AgentService(dirname(path), () => {}, () => model)
  cleanups.push(() => service.close())
  await service.sync([{ id: 'alice', soul: '写作者', conversation: '', config: { provider: 'openai', baseUrl: 'http://test.invalid', apiKey: 'fixture', model: 'fixture', thinkingDisabledModels: [] } }])
  await vi.waitFor(() => expect(service.store.overview('alice').reports).toHaveLength(1))
  expect(service.store.profile('alice')!.failures).toBe(0)
  expect(model).toHaveBeenCalled()
  expect(service.store.overview('alice').runs[0].status).toBe('completed')
})
it('waits for work hours and preserves a stopped task after deletion', () => {
  const { store, topic } = fixture(); const due = store.providerRecovery('alice')!.at
  store.save('alice', { ...store.overview('alice').settings, workHours: { start: '15:00', end: '16:00' } }, Date.now(), false)
  expect(store.nextScheduledTopic('alice', due)).toBeUndefined()
  const task = store.topics.get('alice', topic)
  store.deleteTopic('alice', topic, task.revision)
  expect(store.providerRecovery('alice')).toBeUndefined()
})

it('does not call the provider when Token allowance is insufficient for recovery', async () => {
  const { store, path } = fixture()
  store.save('alice', { ...store.overview('alice').settings, dailyTokenLimit: 1 }, Date.now(), false)
  vi.setSystemTime(store.providerRecovery('alice')!.at)
  const model = vi.fn(async () => { throw new Error('must not be called') })
  const service = new AgentService(dirname(path), () => {}, () => model)
  cleanups.push(() => service.close())
  await service.sync([{ id: 'alice', soul: '', conversation: '', config: { provider: 'openai', baseUrl: 'http://test.invalid', apiKey: 'fixture', model: 'fixture', thinkingDisabledModels: [] } }])
  await vi.waitFor(() => expect(service.store.overview('alice').runs[0].status).toBe('interrupted'))
  expect(model).not.toHaveBeenCalled()
  expect(service.store.decisions.pending('alice').some(card => card.kind === 'budget')).toBe(true)
})
