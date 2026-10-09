import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentStore } from './store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { AgentService } from './service'

const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup() })
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-work-settings-'))
  const path = join(dir, 'agents.db'), store = new AgentStore(path)
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }), () => store.close())
  store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: '写作', enabled: true, dailyCalls: 100, dailyTokenLimit: 10000, defaultTaskTokenLimit: 6000 }, Date.now(), false)
  return { store, path }
}
it('preserves running and waiting rounds when switching to manual, and rejects stale settings', () => {
  const { store } = fixture()
  const task = store.assignTopic('alice', '写一篇文章', '')
  const run = store.overview('alice').runs[0]
  store.wait(run.id, '使用哪个主题？')
  const before = store.overview('alice')
  store.save('alice', { ...before.settings, enabled: false }, Date.now(), false, before.revision)
  expect(store.getRun(run.id)?.status).toBe('waiting')
  expect(store.assertLive(run.id).topic_id).toBe(task.id)
  expect(() => store.save('alice', before.settings, Date.now(), false, before.revision)).toThrow('已变化')
  store.answer('alice', run.id, '技术主题')
  expect(store.getRun(run.id)?.status).toBe('queued')
})
it('copies the default token cap only to new tasks and validates first-time settings revision', () => {
  const { store } = fixture()
  store.save('new', { ...DEFAULT_AGENT_SETTINGS, goal: '新联系人', defaultTaskTokenLimit: 4000 }, Date.now(), false, 0)
  const first = store.createTopic('alice', { title: '第一篇', goal: '写作', constraints: '' }).topics[0]
  store.save('alice', { ...store.overview('alice').settings, defaultTaskTokenLimit: 8000 }, Date.now(), false)
  const second = store.createTopic('alice', { title: '第二篇', goal: '写作', constraints: '' }).topics[0]
  expect(store.topics.get('alice', first.id).tokenLimit).toBe(6000)
  expect(second.tokenLimit).toBe(8000)
})
it('reserves before requests, settles actual usage and preserves unknown usage across restart and deletion', () => {
  const { store, path } = fixture()
  const task = store.assignTopic('alice', '写文章', ''), run = store.overview('alice').runs[0]
  store.charge(run.id)
  const first = store.tokens.reserve(run.id, store.latestCallId(run.id)!, 'alice', task.id, 'hello', 2000)
  expect(first.error).toBeUndefined()
  store.tokens.settle(first.key!, { usage: { totalTokens: 1000 }, finishReason: 'stop' })
  store.charge(run.id)
  const second = store.tokens.reserve(run.id, store.latestCallId(run.id)!, 'alice', task.id, 'hello', 2000)
  store.tokens.settle(second.key!, {})
  expect(store.tokens.usage('alice').today).toBe(3517)
  expect(store.tokens.usage('alice').estimated).toBe(1)
  const reopened = new AgentStore(path); cleanups.push(() => reopened.close())
  expect(reopened.tokens.usage('alice').today).toBe(3517)
  reopened.deleteTopic('alice', task.id, reopened.topics.get('alice', task.id).revision)
  expect(reopened.tokens.usage('alice').today).toBe(3517)
})
it('enforces daily and lifetime caps independently and unblocks only when enough quota is available', () => {
  const { store } = fixture(), now = Date.now()
  const task = store.assignTopic('alice', '写文章', ''), run = store.overview('alice').runs[0]
  const first = store.tokens.reserve(run.id, 999, 'alice', task.id, 'hello', 5000, now)
  store.tokens.settle(first.key!, { usage: { totalTokens: 5900 }, finishReason: 'stop' })
  expect(store.tokens.reserve(run.id, 1000, 'alice', task.id, 'hello', 5000, now).error).toContain('本任务累计')
  expect(store.tokens.canResume(run.id, 'alice', task.id, now + 86400000)).toBe(false)
  store.topics.tokenBudget('alice', task.id, store.topics.get('alice', task.id).revision, 20000)
  store.save('alice', { ...store.overview('alice').settings, dailyTokenLimit: 6000 }, now, false)
  expect(store.tokens.reserve(run.id, 1000, 'alice', task.id, 'hello', 5000, now).error).toContain('今日工作')
  expect(store.tokens.canResume(run.id, 'alice', task.id, now + 86400000)).toBe(true)
  expect(() => store.save('alice', { ...store.overview('alice').settings, dailyTokenLimit: 100 }, now, false)).toThrow('已消耗或预留')
})
it('retains the chosen mode after failures and still blocks automatic dispatch', () => {
  const { store } = fixture()
  store.assignTopic('alice', '写文章', '')
  for (let i = 0; i < 3; i++) { const run = store.createRun('alice', ''); store.fail(run, '模型不可用') }
  expect(store.overview('alice').settings.enabled).toBe(true)
  expect(store.overview('alice').failures).toBe(3)
  expect(store.nextScheduledTopic('alice', Date.now() + 86400000)).toBeUndefined()
})

it('pauses only the task with an exhausted lifetime token budget', () => {
  const { store } = fixture()
  const first = store.assignTopic('alice', '第一项任务', '')
  const run = store.overview('alice').runs[0]
  store.topics.tokenBudget('alice', first.id, first.revision, 100)
  expect(store.tokens.reserve(run.id, 999, 'alice', first.id, 'hello', 2000).error).toContain('本任务累计')
  store.fail(run.id, 'request blocked')
  expect(store.getRun(run.id)?.status).toBe('cancelled')
  expect(store.topics.get('alice', first.id).status).toBe('paused')
  const second = store.assignTopic('alice', '第二项任务', '')
  expect(store.overview('alice').runs.some(r => r.topicId === second.id && r.status === 'queued')).toBe(true)
  expect(store.overview('alice').failures).toBe(0)
})

it('allows unrelated settings changes after the automatic deadline expires', () => {
  const { store } = fixture(), now = Date.now()
  store.save('alice', { ...store.overview('alice').settings, workUntil: now + 1000 }, now, false)
  expect(() => store.save('alice', { ...store.overview('alice').settings, notifyProgress: false }, now + 2000, false)).not.toThrow()
})

it('blocks the actual model before assignment parsing and resumes after a daily cap increase', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-token-service-'))
  const model = vi.fn(async () => JSON.stringify({ title: '写作', nextStep: '了解主题', question: '写什么主题？', plan: { completionCriteria: '完成文章', stages: [{ id: 'draft', title: '写作', status: 'pending' }] } }))
  const service = new AgentService(dir, () => {}, () => model)
  try {
    service.store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: '写作', dailyTokenLimit: 100, dailyCalls: 100 }, Date.now(), false)
    await service.sync([{ id: 'alice', soul: '', conversation: '', config: { provider: 'openai', baseUrl: 'http://127.0.0.1:1', model: 'synthetic', apiKey: 'synthetic', thinkingDisabledModels: [] } }])
    await service.request('assignTopic', 'alice', ['写一篇文章'])
    await vi.waitFor(() => expect(service.store.overview('alice').runs[0]?.status).toBe('interrupted'))
    expect(model).not.toHaveBeenCalled()
    expect(service.store.callCount('alice')).toBe(0)
    service.tick(); service.tick()
    expect(model).not.toHaveBeenCalled()
    const data = service.store.overview('alice')
    await service.request('savePreferences', 'alice', [{ ...data.settings, dailyTokenLimit: 100000 }, data.revision])
    await vi.waitFor(() => expect(service.store.overview('alice').runs[0].status).toBe('waiting'))
    expect(model).toHaveBeenCalledTimes(1)
    expect(service.store.overview('alice').failures).toBe(0)
    expect(service.store.tokens.usage('alice').today).toBeGreaterThan(0)
  } finally { await service.close(); rmSync(dir, { recursive: true, force: true }) }
})

it('persists recurring hours and dispatches queued automatic work only inside the window', () => {
  const { store } = fixture()
  const now = Date.now(), minute = new Date(now).getHours() * 60 + new Date(now).getMinutes()
  const time = (n: number) => `${String(Math.floor((n % 1440) / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
  const hours = { start: time(minute + 60), end: time(minute + 120) }
  store.save('alice', { ...store.overview('alice').settings, workHours: hours }, now, false)
  const task = store.assignTopic('alice', '时段内执行', '')
  expect(store.overview('alice').settings.workHours).toEqual(hours)
  expect(store.overview('alice').runs).toHaveLength(0)
  expect(store.nextScheduledTopic('alice', now)).toBeUndefined()
  expect(store.nextScheduledTopic('alice', now + 60 * 60000)).toBe(task.id)
  store.save('alice', { ...store.overview('alice').settings, workHours: undefined }, now, false)
  expect(store.nextScheduledTopic('alice', now)).toBe(task.id)
})

it('cleans obsolete deadlines on restart and can enable automatic work with the existing revision', () => {
  const { store, path } = fixture()
  const task = store.createTopic('alice', { title: '旧任务', goal: '继续工作', constraints: '' }).topics[0]
  store.focusTopic('alice', task.id)
  const before = store.overview('alice')
  store.db.prepare('UPDATE profiles SET settings=? WHERE character_id=?').run(JSON.stringify({ ...before.settings, enabled: false, workUntil: 1 }), 'alice')
  const reopened = new AgentStore(path); cleanups.push(() => reopened.close())
  expect(JSON.parse(reopened.profile('alice')!.settings)).not.toHaveProperty('workUntil')
  expect(reopened.overview('alice').revision).toBe(before.revision)
  reopened.save('alice', { ...reopened.overview('alice').settings, enabled: true }, Date.now(), false, before.revision)
  expect(reopened.overview('alice').settings.enabled).toBe(true)
  expect(reopened.nextScheduledTopic('alice')).toBe(task.id)
})
