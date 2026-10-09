import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentStore } from './store'
import { AgentRuntime } from './runtime'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'

const cleanups: (() => void)[] = []
afterEach(() => { for (const close of cleanups.splice(0).reverse()) close() })
const plan = { action: 'write', reason: '继续原任务', query: '', urls: [], checkAfterMinutes: 15 }
const progress = { status: 'researching', judgement: '新增一个 idea', reason: '按原目标产出', openQuestions: '', nextStep: '继续产出下一个 idea' }
const draft = { title: '新 idea', body: '真实交付', nextStep: progress.nextStep, memories: [], question: '', progress,
  delivery: { completionCriteria: '持续产出 idea', summary: '第一个 idea', stages: [{ id: 'ideas', title: '产出', status: 'active' }], section: { id: 'idea1', title: 'idea1', body: '完整 idea 正文' } } }
const optional = { ...draft, question: '是否认可此MVP验证计划，直接启动招募？', nextStep: '启动招募' }
const optionalDecision = { blocking: false, reason: '用户只要求持续产出，招募不是原任务的前置条件', missingInformation: '', nextStep: '继续产出下一个 idea' }
function fixture(enabled = true) {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-boundary-'))
  let store = new AgentStore(join(dir, 'agents.db')), runtime = new AgentRuntime(store, join(dir, 'checkpoints.db'))
  store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: '持续产出 AI 产品 idea，只交付想法和验证方法', enabled, dailyCalls: 100, intervalMinutes: 15 })
  cleanups.push(() => { runtime.close(); store.close(); rmSync(dir, { recursive: true, force: true }) })
  return { get store() { return store }, get runtime() { return runtime }, reopen() { runtime.close(); store.close(); store = new AgentStore(join(dir, 'agents.db')); runtime = new AgentRuntime(store, join(dir, 'checkpoints.db')); store.recover() } }
}
const json = JSON.stringify
it('rejects an optional expansion, produces the original deliverable, and never invents an answer', async () => {
  const f = fixture(), run = f.store.createRun('alice', '')
  const model = vi.fn().mockResolvedValueOnce(json(plan)).mockResolvedValueOnce(json(optional))
    .mockResolvedValueOnce(json(optionalDecision)).mockResolvedValueOnce(json(draft))
  await f.runtime.execute(run, '', model, new AbortController().signal)
  expect(f.store.getRun(run)?.status).toBe('completed')
  expect(f.store.getRun(run)?.answer).toBe('')
  expect(f.store.detail('alice', run).report?.body).toBe('真实交付')
  expect(f.store.detail('alice', run).events.some(e => e.kind === 'waiting')).toBe(false)
  expect(f.store.notices.pending('alice').map(n => n.kind)).toEqual(['progress'])
  expect(f.store.callCount('alice')).toBe(4)
  expect(model.mock.calls[3][0]).toContain('不能声称用户已认可')
})
it('keeps a necessary question and resumes only after the real answer, without repeating the audit', async () => {
  const f = fixture(), run = f.store.createRun('alice', '')
  const required = { ...draft, question: '必须排除哪个已有产品方向？' }
  const model = vi.fn().mockResolvedValueOnce(json(plan)).mockResolvedValueOnce(json(required))
    .mockResolvedValueOnce(json({ blocking: true, reason: '原任务要求排除用户内部正在做的方向，但未提供', missingInformation: '需排除的产品方向', nextStep: '' }))
  await f.runtime.execute(run, '', model, new AbortController().signal)
  expect(f.store.getRun(run)?.status).toBe('waiting')
  expect(f.store.detail('alice', run).report).toBeNull()
  f.reopen()
  expect(f.store.runnable()).toEqual([])
  f.store.answer('alice', run, '排除日记方向')
  const resumed = vi.fn(async () => json(draft))
  await f.runtime.execute(run, '', resumed, new AbortController().signal)
  expect(resumed).toHaveBeenCalledTimes(1)
  expect(f.store.getRun(run)?.status).toBe('completed')
  expect(f.store.getRun(run)?.answer).toBe('排除日记方向')
})
it('rechecks a legacy waiting checkpoint after restart and recovers without a synthetic user reply', async () => {
  const f = fixture(false), run = f.store.createRun('alice', '')
  await f.runtime.execute(run, '', vi.fn().mockResolvedValueOnce(json(plan)).mockResolvedValueOnce(json(optional)), new AbortController().signal)
  expect(f.store.getRun(run)?.status).toBe('waiting')
  f.store.save('alice', { ...f.store.overview('alice').settings, enabled: true }, Date.now(), false)
  f.reopen()
  expect(f.store.runnable().map(r => r.id)).toEqual([run])
  const model = vi.fn().mockResolvedValueOnce(json(optionalDecision)).mockResolvedValueOnce(json(draft))
  await f.runtime.execute(run, '', model, new AbortController().signal)
  expect(f.store.getRun(run)?.status).toBe('completed')
  expect(f.store.getRun(run)?.answer).toBe('')
  expect(f.store.detail('alice', run).report?.body).not.toContain('用户补充')
  expect(model).toHaveBeenCalledTimes(2)
})
it('retains a legacy question when the audit cannot be trusted and does not retry every restart', async () => {
  const f = fixture(false), run = f.store.createRun('alice', '')
  await f.runtime.execute(run, '', vi.fn().mockResolvedValueOnce(json(plan)).mockResolvedValueOnce(json(optional)), new AbortController().signal)
  f.store.save('alice', { ...f.store.overview('alice').settings, enabled: true }, Date.now(), false)
  f.reopen()
  await f.runtime.execute(run, '', async () => '{}', new AbortController().signal)
  expect(f.store.getRun(run)?.status).toBe('waiting')
  expect(f.store.getRun(run)?.question).toBe(optional.question)
  expect(f.store.getRun(run)?.answer).toBe('')
  f.reopen(); expect(f.store.runnable()).toEqual([])
})
it.each(['question', 'completed'])('does not accept a correction that bypasses the task with %s', async fault => {
  const f = fixture(), run = f.store.createRun('alice', '')
  const corrected = fault === 'question' ? optional : { ...draft, progress: { ...progress, status: 'completed' } }
  await f.runtime.execute(run, '', vi.fn().mockResolvedValueOnce(json(plan)).mockResolvedValueOnce(json(optional))
    .mockResolvedValueOnce(json(optionalDecision)).mockResolvedValueOnce(json(corrected)), new AbortController().signal)
  expect(f.store.getRun(run)?.status).toBe('failed')
  expect(f.store.detail('alice', run).report).toBeNull()
  expect(f.store.getRun(run)?.answer).toBe('')
})
it('charges the audit against the existing daily allowance and stops before an unaffordable correction', async () => {
  const f = fixture()
  f.store.save('alice', { ...f.store.overview('alice').settings, dailyCalls: 3 })
  const run = f.store.createRun('alice', '')
  const model = vi.fn().mockResolvedValueOnce(json(plan)).mockResolvedValueOnce(json(optional)).mockResolvedValueOnce(json(optionalDecision))
  await f.runtime.execute(run, '', model, new AbortController().signal)
  expect(model).toHaveBeenCalledTimes(3)
  expect(f.store.detail('alice', run).report).toBeNull()
  expect(f.store.callCount('alice')).toBe(3)
})
it('discards a late boundary decision after the user pauses the task', async () => {
  const f = fixture(), run = f.store.createRun('alice', '')
  const model = vi.fn().mockResolvedValueOnce(json(plan)).mockResolvedValueOnce(json(optional)).mockImplementationOnce(async () => {
    f.store.cancel('alice', '用户暂停'); return json(optionalDecision)
  })
  await f.runtime.execute(run, '', model, new AbortController().signal)
  expect(f.store.getRun(run)?.status).toBe('cancelled')
  expect(f.store.detail('alice', run).report).toBeNull()
  expect(model).toHaveBeenCalledTimes(3)
})

it('never restores a known optional question when its correction is malformed; retries the original task after restart', async () => {
  const f = fixture(false), run = f.store.createRun('alice', '')
  await f.runtime.execute(run, '', vi.fn().mockResolvedValueOnce(json(plan)).mockResolvedValueOnce(json(optional)), new AbortController().signal)
  f.store.save('alice', { ...f.store.overview('alice').settings, enabled: true }, Date.now(), false)
  f.reopen()
  await f.runtime.execute(run, '', vi.fn().mockResolvedValueOnce(json(optionalDecision)).mockResolvedValueOnce('{invalid'), new AbortController().signal)
  expect(f.store.getRun(run)?.status).toBe('failed')
  expect(f.store.getRun(run)?.answer).toBe('')
  expect(f.store.notices.pending('alice').every(n => n.kind !== 'question')).toBe(true)
  const topicId = f.store.getRun(run)!.topic_id!
  expect(f.store.topics.get('alice', topicId).nextStep).toContain('继续用户原任务')
  expect(f.store.detail('alice', run).report).toBeNull()
  f.reopen()
  expect(f.store.nextScheduledTopic('alice', Date.now() + 61000)).toBe(topicId)
  const retry = f.store.createRun('alice', '')
  await f.runtime.execute(retry, '', vi.fn().mockResolvedValueOnce(json(plan)).mockResolvedValueOnce(json(draft)), new AbortController().signal)
  expect(f.store.getRun(retry)?.status).toBe('completed')
  expect(f.store.overview('alice').failures).toBe(0)
  expect(f.store.getRun(run)?.answer).toBe('')
})
