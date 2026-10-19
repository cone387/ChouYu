import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ContactTaskStore } from '../task-center/contact-store'
import { WorkStrategyRuntime } from '../workloop/workflow'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { taskState } from '../../shared/task-state'
import { reviewTaskCompletion } from './task-completion'
import type { DeliveryUpdate } from '../../shared/agent-delivery'

const cleanups: (() => void)[] = []
afterEach(() => { for (const close of cleanups.splice(0).reverse()) close() })
const plan = { action: 'write', reason: '产出想法', query: '', urls: [], checkAfterMinutes: 15 }
const draft = { title: '想法一', body: '新的想法', question: '', memories: [], progress: { status: 'completed', judgement: '交付一个想法', reason: '本轮产出', nextStep: '', openQuestions: '' }, delivery: { completionCriteria: '产出一个想法', summary: '想法一', stages: [{ id: 'ideas', title: '产出', status: 'done' }], section: { id: 'idea1', title: '想法一', body: '有用的想法正文' } } }
const decision = { mode: 'ongoing', satisfied: true, endsAt: null, reason: '用户要求持续生产，单条交付不结束任务', nextStep: '继续产出下一条想法', completionCriteria: '持续产出，直到用户明确结束' }
function fixture(goal = '全天持续生产 AI 产品 idea') {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-completion-'))
  let store = new ContactTaskStore(join(dir, 'agents.db')), runtime = new WorkStrategyRuntime(store, join(dir, 'checkpoints.db'))
  store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal, enabled: true, dailyCalls: 100, intervalMinutes: 15 })
  cleanups.push(() => { runtime.close(); store.close(); rmSync(dir, { recursive: true, force: true }) })
  return { get store() { return store }, get runtime() { return runtime }, reopen() { runtime.close(); store.close(); store = new ContactTaskStore(join(dir, 'agents.db')); runtime = new WorkStrategyRuntime(store, join(dir, 'checkpoints.db')); store.recover() } }
}
it.each(['completed', 'abandoned'])('preserves the deliverable and keeps ongoing work scheduled when the model proposes %s', async status => {
  const f = fixture(), run = f.store.createRun('alice', '')
  const model = vi.fn().mockResolvedValueOnce(JSON.stringify(plan)).mockResolvedValueOnce(JSON.stringify({ ...draft, progress: { ...draft.progress, status } })).mockResolvedValueOnce(JSON.stringify(decision))
  await f.runtime.execute(run, '', model, new AbortController().signal)
  const topicId = f.store.getRun(run)!.topic_id!
  expect(f.store.topics.get('alice', topicId).status).toBe('researching')
  expect(f.store.getRun(run)?.status).toBe('completed')
  expect(f.store.deliveries.get(topicId)?.sections[0].body).toBe(draft.delivery.section.body)
  expect(f.store.nextScheduledTopic('alice', Date.now() + 1000)).toBe(topicId)
  expect(model).toHaveBeenCalledTimes(3)
  f.reopen()
  expect(f.store.topics.get('alice', topicId).status).toBe('researching')
})
it.each([false, true])('checks an explicit deadline against the system clock (elapsed=%s)', async elapsed => {
  const f = fixture('持续生产到指定时间结束'), run = f.store.createRun('alice', '')
  const endsAt = new Date(Date.now() + (elapsed ? -1000 : 3600000)).toISOString()
  const model = vi.fn().mockResolvedValueOnce(JSON.stringify(plan)).mockResolvedValueOnce(JSON.stringify(draft)).mockResolvedValueOnce(JSON.stringify({ ...decision, mode: 'until', endsAt }))
  await f.runtime.execute(run, '', model, new AbortController().signal)
  expect(f.store.topics.get('alice', f.store.getRun(run)!.topic_id!).status).toBe(elapsed ? 'completed' : 'researching')
})
it('allows a verified finite task to end without disabling normal completion', async () => {
  const f = fixture('给我一个产品想法'), run = f.store.createRun('alice', '')
  const model = vi.fn().mockResolvedValueOnce(JSON.stringify(plan)).mockResolvedValueOnce(JSON.stringify(draft)).mockResolvedValueOnce(JSON.stringify({ ...decision, mode: 'finite' }))
  await f.runtime.execute(run, '', model, new AbortController().signal)
  expect(f.store.topics.get('alice', f.store.getRun(run)!.topic_id!).status).toBe('completed')
})
it('fails visibly without ending the task when the completion check is invalid', async () => {
  const f = fixture(), run = f.store.createRun('alice', '')
  const model = vi.fn().mockResolvedValueOnce(JSON.stringify(plan)).mockResolvedValueOnce(JSON.stringify(draft)).mockResolvedValueOnce('{}')
  await f.runtime.execute(run, '', model, new AbortController().signal)
  expect(f.store.getRun(run)?.status).toBe('failed')
  expect(f.store.topics.get('alice', f.store.getRun(run)!.topic_id!).status).not.toBe('completed')
  expect(f.store.detail('alice', run).report).toBeNull()
})
it('checks older saved sections and replacement text instead of just the last three sections', async () => {
  const f = fixture('写完五章，每章包含指定情节')
  for (let n = 1; n <= 5; n++) {
    const run = f.store.createRun('alice', '')
    f.store.finish(run, { runId: run, title: `第${n}章`, body: '正文', nextStep: '继续', evidence: [], createdAt: Date.now() }, [],
      { ...draft.progress, status: 'researching', nextStep: '继续' }, { ...draft.delivery, section: { id: `chapter${n}`, title: `第${n}章`, body: `第${n}章真实正文` } } as DeliveryUpdate)
  }
  const run = f.store.createRun('alice', '')
  const model = vi.fn().mockResolvedValueOnce(JSON.stringify(plan)).mockResolvedValueOnce(JSON.stringify(draft)).mockImplementationOnce(async (prompt: string) => {
    expect(prompt).toContain('第1章真实正文')
    expect(prompt).toContain('第5章真实正文')
    expect(prompt).toContain('"readComplete":true')
    return JSON.stringify({ ...decision, mode: 'finite' })
  })
  await f.runtime.execute(run, '', model, new AbortController().signal)
  expect(f.store.topics.get('alice', f.store.getRun(run)!.topic_id!).status).toBe('completed')
})
it('keeps a durable decision across restart and includes the stable user-edit time', async () => {
  const f = fixture(), original = f.store.topics.list('alice')[0]
  f.store.changeTopic('alice', original.id, original.revision, { input: { ...original, constraints: '从现在起再运行24小时后结束' }, reason: '用户修改期限' })
  const editedAt = f.store.topics.detail('alice', original.id).changes[0].after.updatedAt
  for (let n = 0; n < 25; n++) {
    const latest = f.store.topics.get('alice', original.id)
    f.store.topics.edit('alice', original.id, latest.revision, { ...latest, title: `新名称 ${n}` }, '只改名称')
  }
  const run = f.store.createRun('alice', ''), topic = f.store.topics.get('alice', original.id)
  const candidate = { ...draft, nextStep: '', progress: { ...draft.progress, status: 'completed' as const }, delivery: draft.delivery as DeliveryUpdate }
  const model = vi.fn(async (prompt: string) => {
    expect(prompt).toContain(new Date(editedAt).toISOString())
    expect(prompt).toContain('从现在起再运行24小时后结束')
    expect(prompt).toContain('"userChangesComplete":true')
    return JSON.stringify(decision)
  })
  const check = () => reviewTaskCompletion(f.store, run, topic, candidate, model, new AbortController().signal, () => { f.store.assertLive(run) })
  expect((await check()).progress?.status).toBe('researching')
  f.reopen()
  expect((await check()).progress?.status).toBe('researching')
  expect(model).toHaveBeenCalledTimes(1)
  expect(f.store.callCount('alice')).toBe(1)
})
function longFixture() {
  const f = fixture('完成一份长文')
  for (let n = 1; n <= 7; n++) {
    const run = f.store.createRun('alice', '')
    f.store.finish(run, { runId: run, title: '正文', body: '正文', nextStep: '继续', evidence: [], createdAt: Date.now() }, [],
      { ...draft.progress, status: 'researching', nextStep: '继续' }, { ...draft.delivery, section: { id: `part${n}`, title: `第${n}部分`, body: `${n}`.repeat(10000) } } as DeliveryUpdate)
  }
  const run = f.store.createRun('alice', ''), topic = f.store.topics.list('alice')[0]
  const candidate = { ...draft, nextStep: '', progress: { ...draft.progress, status: 'completed' as const }, delivery: draft.delivery as DeliveryUpdate }
  return { f, run, topic, candidate }
}
function batchReply(prompt: string, issues: string[] = []) {
  const input = JSON.parse(prompt.split('\n核对数据：\n')[1])
  return JSON.stringify({ key: input.key, readComplete: true, summary: '已核对该范围的实际正文与用户要求', issues, opening: '开始', closing: '结尾' })
}
it('reviews every long section before accepting finite completion and persists charged receipts', async () => {
  const { f, run, topic, candidate } = longFixture()
  const bodies: string[] = []
  const model = vi.fn(async (prompt: string) => {
    if (prompt.startsWith('正文分批核对')) {
      bodies.push(JSON.parse(prompt.split('\n核对数据：\n')[1]).part.body)
      return batchReply(prompt)
    }
    expect(bodies).toHaveLength(8)
    expect(prompt).toContain('"readComplete":true')
    return JSON.stringify({ ...decision, mode: 'finite', nextStep: '' })
  })
  expect((await reviewTaskCompletion(f.store, run, topic, candidate, model, new AbortController().signal, () => { f.store.assertLive(run) })).progress?.status).toBe('completed')
  for (let n = 1; n <= 7; n++) expect(bodies).toContain(`${n}`.repeat(10000))
  expect(f.store.callCount('alice')).toBe(9)
  f.reopen()
  await reviewTaskCompletion(f.store, run, topic, candidate, model, new AbortController().signal, () => { f.store.assertLive(run) })
  expect(f.store.callCount('alice')).toBe(9)
})
it('retains successful long-review batches after failure and restart without charging them again', async () => {
  const { f, run, topic, candidate } = longFixture()
  let fail = true
  const seen: string[] = []
  const model = vi.fn(async (prompt: string) => {
    if (!prompt.startsWith('正文分批核对')) return JSON.stringify({ ...decision, mode: 'finite' })
    const part = JSON.parse(prompt.split('\n核对数据：\n')[1]).part
    seen.push(part.sectionId)
    if (part.sectionId === 'part3' && fail) throw new Error('网络中断')
    return batchReply(prompt)
  })
  const check = () => reviewTaskCompletion(f.store, run, topic, candidate, model, new AbortController().signal, () => { f.store.assertLive(run) })
  await expect(check()).rejects.toThrow('网络中断')
  f.reopen(); fail = false
  expect((await check()).progress?.status).toBe('completed')
  expect(seen.filter(id => id === 'part1')).toHaveLength(1)
  expect(seen.filter(id => id === 'part2')).toHaveLength(1)
  expect(seen.filter(id => id === 'part3')).toHaveLength(2)
  expect(f.store.callCount('alice')).toBe(10)
})
it('invalidates only changed text batches but rechecks the global conclusion', async () => {
  const { f, run, topic, candidate } = longFixture()
  const reviewed: string[] = []
  const model = vi.fn(async (prompt: string) => {
    if (!prompt.startsWith('正文分批核对')) return JSON.stringify({ ...decision, mode: 'finite' })
    reviewed.push(JSON.parse(prompt.split('\n核对数据：\n')[1]).part.sectionId)
    return batchReply(prompt)
  })
  const check = (value = candidate) => reviewTaskCompletion(f.store, run, topic, value, model, new AbortController().signal, () => { f.store.assertLive(run) })
  await check()
  await check({ ...candidate, delivery: { ...candidate.delivery, section: { ...candidate.delivery.section!, body: '修改后的结尾' } } })
  expect(reviewed.filter(id => id === 'part1')).toHaveLength(1)
  expect(reviewed.filter(id => id === 'idea1')).toHaveLength(2)
  expect(f.store.callCount('alice')).toBe(11)
})
it('reuses long-review facts after recapture or unrelated chat, but invalidates changed source text and task feedback', async () => {
  const { f, run, topic, candidate } = longFixture()
  let active = run, reviewed = 0, finals = 0
  const model = async (prompt: string) => {
    if (prompt.startsWith('正文分批核对')) { reviewed++; return batchReply(prompt) }
    finals++
    if (finals === 2) expect(prompt).toContain('新闲聊')
    return JSON.stringify({ ...decision, mode: 'finite' })
  }
  const context = { userFeedback: '按原要求核对', userAnswer: '', conversation: '旧闲聊', evidence: [{ url: 'https://example.com/source', title: '资料', text: '相同资料正文', hash: 'same', capturedAt: 1 }] }
  const check = (value: unknown) => reviewTaskCompletion(f.store, active, topic, candidate, model, new AbortController().signal, () => f.store.assertLive(active), value)
  await check(context); expect(reviewed).toBe(8)
  f.store.setStatus(active, 'completed'); f.reopen(); active = f.store.createRun('alice', '')
  const recaptured = { ...context, conversation: '新闲聊', evidence: [{ ...context.evidence[0], capturedAt: 2 }] }
  await check(recaptured); expect(reviewed).toBe(8); expect(finals).toBe(2)
  const changed = { ...recaptured, evidence: [{ ...recaptured.evidence[0], text: '新证据否定原有结论', hash: 'changed' }] }
  await check(changed); expect(reviewed).toBe(16)
  await check({ ...changed, userFeedback: '改用新的核对标准' }); expect(reviewed).toBe(24)
})

it('never accepts completion when a reviewed batch reports a missing requirement', async () => {
  const { f, run, topic, candidate } = longFixture()
  const model = vi.fn(async (prompt: string) => prompt.startsWith('正文分批核对')
    ? batchReply(prompt, ['正文缺少用户要求的结论依据']) : JSON.stringify({ ...decision, mode: 'finite', nextStep: '' }))
  const result = await reviewTaskCompletion(f.store, run, topic, candidate, model, new AbortController().signal, () => { f.store.assertLive(run) })
  expect(result.progress?.status).toBe('researching')
  expect(result.progress?.reason).toContain('结论依据')
  expect(result.delivery?.section?.body).toBe(candidate.delivery.section?.body)
})
it('preserves the saved chapter order when reviewing a replacement in the middle', async () => {
  const { f, run, topic, candidate } = longFixture()
  const replacement = { ...candidate, delivery: { ...candidate.delivery, section: { id: 'part3', title: '第三部分修改', body: '新的第三部分' } } }
  const model = async (prompt: string) => {
    if (prompt.startsWith('正文分批核对')) return batchReply(prompt)
    const data = JSON.parse(prompt.split('\n').at(-1)!)
    expect(data.evidence.batches.directory.map((s: { id: string }) => s.id)).toEqual(['part1', 'part2', 'part3', 'part4', 'part5', 'part6', 'part7'])
    return JSON.stringify({ ...decision, mode: 'finite' })
  }
  expect((await reviewTaskCompletion(f.store, run, topic, replacement, model, new AbortController().signal, () => { f.store.assertLive(run) })).progress?.status).toBe('completed')
})
it('rejects forged or incomplete batch receipts without caching them as reviewed', async () => {
  const { f, run, topic, candidate } = longFixture()
  const model = vi.fn(async (prompt: string) => prompt.startsWith('正文分批核对')
    ? JSON.stringify({ ...JSON.parse(batchReply(prompt)), key: 'different-text', readComplete: false }) : JSON.stringify({ ...decision, mode: 'finite' }))
  await expect(reviewTaskCompletion(f.store, run, topic, candidate, model, new AbortController().signal, () => { f.store.assertLive(run) })).rejects.toThrow('分批核对')
  expect(f.store.topics.get('alice', topic.id).status).not.toBe('completed')
})
it('enforces the existing call budget between long-review batches and resumes saved ranges after replenishment', async () => {
  const { f, run, topic, candidate } = longFixture()
  f.store.db.prepare("UPDATE profiles SET settings=json_set(settings,'$.dailyCalls',2) WHERE character_id='alice'").run()
  const model = vi.fn(async (prompt: string) => prompt.startsWith('正文分批核对') ? batchReply(prompt) : JSON.stringify({ ...decision, mode: 'finite' }))
  const check = () => reviewTaskCompletion(f.store, run, topic, candidate, model, new AbortController().signal, () => { f.store.assertLive(run) })
  await expect(check()).rejects.toThrow('上限')
  expect(f.store.callCount('alice')).toBe(2)
  f.store.db.prepare("UPDATE profiles SET settings=json_set(settings,'$.dailyCalls',100) WHERE character_id='alice'").run()
  expect((await check()).progress?.status).toBe('completed')
  expect(f.store.callCount('alice')).toBe(9)
})
it('charges the check to existing budgets and cannot accept a late decision after pause', async () => {
  const f = fixture(), run = f.store.createRun('alice', '')
  const model = vi.fn().mockResolvedValueOnce(JSON.stringify(plan)).mockResolvedValueOnce(JSON.stringify(draft)).mockImplementationOnce(async () => {
    f.store.cancel('alice', '用户暂停'); return JSON.stringify(decision)
  })
  await f.runtime.execute(run, '', model, new AbortController().signal)
  expect(f.store.getRun(run)?.status).toBe('cancelled')
  expect(f.store.detail('alice', run).report).toBeNull()
  expect(f.store.callCount('alice')).toBe(3)
})
it('does not spend beyond the daily allowance for a completion check or end the task without one', async () => {
  const f = fixture()
  f.store.save('alice', { ...f.store.overview('alice').settings, dailyCalls: 2 })
  const run = f.store.createRun('alice', '')
  const model = vi.fn().mockResolvedValueOnce(JSON.stringify(plan)).mockResolvedValueOnce(JSON.stringify(draft))
  await f.runtime.execute(run, '', model, new AbortController().signal)
  expect(model).toHaveBeenCalledTimes(2)
  expect(f.store.topics.get('alice', f.store.getRun(run)!.topic_id!).status).not.toBe('completed')
})
it('projects persisted waiting and Token reservation requirements for the same task across restart', () => {
  const f = fixture(), run = f.store.createRun('alice', '')
  const topicId = f.store.getRun(run)!.topic_id!
  f.store.saveResearch(run, { plan: { ...plan, action: 'wait' }, searches: [], reads: [] })
  f.store.defer(run, '没有新成果')
  f.reopen()
  let data = f.store.overview('alice')
  expect(taskState(data, data.topics[0]).label).toBe('等待新内容')
  f.store.save('alice', { ...data.settings, dailyTokenLimit: 2000 }, Date.now(), false)
  const next = f.store.createRun('alice', '')
  expect(f.store.tokens.reserve(next, 1, 'alice', topicId, 'x'.repeat(3000), 512).error).toBeDefined()
  f.store.fail(next, 'Token blocked')
  data = f.store.overview('alice')
  expect(taskState(data, data.topics[0]).description).toContain('次日也无法执行')
})
