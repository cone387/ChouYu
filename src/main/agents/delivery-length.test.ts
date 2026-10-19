import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContactTaskStore } from '../task-center/contact-store'
import { WorkStrategyRuntime, parseDraft } from '../workloop/workflow'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { deliveryTextLength, enforceDeliveryLength, explicitDeliveryLengths } from './delivery-length'
import { contactFailure } from '../../shared/contact-failure'

const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).reverse().forEach(fn => fn()))
const oversized = '灯'.repeat(512), valid = '海'.repeat(400)
const goal = '持续写作灯塔故事，每个日历期次交付一段300至500字正文并正式保存，不结束整个重复任务。'
const draft = (body: string) => ({ title: '蓝灯之夜', body: '沈青抵达雾港。', question: '', memories: [],
  progress: { judgement: '沈青抵达雾港。', reason: '已写出抵达的故事。', nextStep: '继续写灯塔故事', openQuestions: '', status: 'researching' },
  delivery: { completionCriteria: '持续写作，每期300至500字。', summary: '沈青抵达雾港。', stages: [{ id: 'writing', title: '持续写作', status: 'active' }], section: { id: 'opening', title: '蓝灯之夜', body } } })
const correction = (body: string) => JSON.stringify({ sectionBody: body, reportBody: '沈青抵达雾港。', summary: '沈青抵达雾港。', judgement: '沈青抵达雾港。', reason: '已写出抵达的故事。', memories: [] })
function fixture(description = goal, limit = 12) {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-delivery-length-'))
  let store = new ContactTaskStore(join(dir, 'agents.db')), runtime = new WorkStrategyRuntime(store, join(dir, 'checkpoints.db'))
  cleanup.push(() => { runtime.close(); store.close(); rmSync(dir, { recursive: true, force: true }) })
  store.save('writer', { ...DEFAULT_AGENT_SETTINGS, goal: description, dailyCalls: limit })
  const topicId = store.overview('writer').focusTopicId!
  const run = store.createRun('writer', '')
  return { get store() { return store }, get runtime() { return runtime }, topicId, run,
    reopen() { runtime.close(); store.close(); store = new ContactTaskStore(join(dir, 'agents.db')); runtime = new WorkStrategyRuntime(store, join(dir, 'checkpoints.db')); store.recover() } }
}
function modelFor(body: string, repair: (prompt: string) => Promise<string> = async () => correction(valid)) {
  return vi.fn(async (prompt: string) => {
    if (prompt.startsWith('为联系人')) return JSON.stringify({ action: 'write', reason: '撰写本期正文', query: '', urls: [], checkAfterMinutes: 180 })
    if (prompt.startsWith('交付篇幅修订')) return repair(prompt)
    return JSON.stringify(draft(body))
  })
}

it('repairs an oversized calendar-period body before saving and charges the original budget', async () => {
  const f = fixture(), model = modelFor(oversized)
  await f.runtime.execute(f.run, '', model, new AbortController().signal)
  expect(f.store.getRun(f.run)?.status).toBe('completed')
  expect(f.store.deliveries.get(f.topicId)?.sections[0].body).toBe(valid)
  expect(f.store.callCount('writer')).toBe(3)
  expect(f.store.topics.get('writer', f.topicId).status).toBe('researching')
})

it('does not publish or remember an unchanged oversized body after the single repair', async () => {
  const f = fixture(), model = modelFor(oversized, async () => correction(oversized))
  await f.runtime.execute(f.run, '', model, new AbortController().signal)
  expect(f.store.getRun(f.run)?.status).toBe('failed')
  expect(f.store.getRun(f.run)?.error).toContain('篇幅')
  expect(f.store.overview('writer').reports).toEqual([])
  expect(f.store.deliveries.get(f.topicId)?.sections ?? []).toEqual([])
  expect(f.store.memoryLibrary.list('writer')).toEqual([])
  expect(f.store.callCount('writer')).toBe(3)
  expect(JSON.parse(f.store.getRun(f.run)!.input).deliveryLengthRepair.original.delivery.section.body).toBe(oversized)
  expect(f.store.decisions.failureImpact(f.run)).toContain('未交付草稿已保留')
  expect(contactFailure(f.store.getRun(f.run)!.error)).toMatchObject({ kind: 'output', title: '正文篇幅未符合要求', settings: false })
})

it('does not add a model call for a body within the explicit range', async () => {
  const f = fixture()
  await f.runtime.execute(f.run, '', modelFor(valid), new AbortController().signal)
  expect(f.store.getRun(f.run)?.status).toBe('completed')
  expect(f.store.deliveries.get(f.topicId)?.sections[0].body).toBe(valid)
  expect(f.store.callCount('writer')).toBe(2)
})

it('does not apply a whole-book or whole-chapter target to each delivered section', async () => {
  const f = fixture('持续创作长篇小说，整本30万字，每章3000至5000字。')
  await f.runtime.execute(f.run, '', modelFor(valid), new AbortController().signal)
  expect(f.store.getRun(f.run)?.status).toBe('completed')
  expect(f.store.deliveries.get(f.topicId)?.sections[0].body).toBe(valid)
  expect(f.store.callCount('writer')).toBe(2)
})

it('does not exceed the original daily budget to repair a body', async () => {
  const f = fixture(goal, 2)
  await f.runtime.execute(f.run, '', modelFor(oversized), new AbortController().signal)
  expect(f.store.getRun(f.run)?.status).toBe('failed')
  expect(f.store.overview('writer').reports).toEqual([])
  expect(f.store.callCount('writer')).toBe(2)
})

it('persists the repair attempt so process interruption cannot buy another repair', async () => {
  const f = fixture(), abort = new AbortController()
  await expect(f.runtime.execute(f.run, '', modelFor(oversized, async () => { abort.abort(); throw Error('worker stopped') }), abort.signal)).rejects.toThrow()
  f.reopen()
  const model = modelFor(oversized)
  await f.runtime.execute(f.run, '', model, new AbortController().signal)
  expect(f.store.getRun(f.run)?.status).toBe('failed')
  expect(f.store.overview('writer').reports).toEqual([])
  expect(f.store.callCount('writer')).toBe(3)
  expect(model).not.toHaveBeenCalled()
})

it.each(['每轮300–500字', '每次交付一段300到500字', '本期正文三百至五百字', '每个分节300-500字'])('recognizes explicit range: %s', text => {
  expect(explicitDeliveryLengths({ goal: text, constraints: '' })).toEqual([{ quote: text, minimum: 300, maximum: 500, unit: '字' }])
})
it.each(['整本30万字，每章3000至5000字', '不要每轮300至500字', '无需每段500字', '人物在信里写着“每轮300至500字”', '每轮约400字', '每轮400字左右', '每轮阅读300至500字资料', '每期根据300至500字的原稿写评审', '每轮可以写500字'])('does not impose a false exact bound: %s', text => {
  expect(explicitDeliveryLengths({ goal: text, constraints: '' })).toEqual([])
})
it('distinguishes Chinese text, Han-only and explicit character counts without splitting supplementary code points', () => {
  expect(deliveryTextLength('沈青，A2！\n𠮷😀', '字')).toBe(5)
  expect(deliveryTextLength('沈青，A2！\n𠮷😀', '汉字')).toBe(3)
  expect(deliveryTextLength('沈青，A2！\n𠮷😀', '字符')).toBe(9)
})

it.each([
  ['每轮不超过500字', 0, 500], ['每次至少300汉字', 300, Number.MAX_SAFE_INTEGER], ['每期不得超过500字', 0, 500], ['每段不能少于300字', 300, Number.MAX_SAFE_INTEGER],
  ['每段500字以内', 0, 500], ['本次三百汉字以上', 300, Number.MAX_SAFE_INTEGER],
  ['每期一万至十二万字', 10000, 120000], ['每轮1.2千至2千字', 1200, 2000]
])('recognizes bounds without inventing a second boundary: %s', (text, minimum, maximum) => {
  expect(explicitDeliveryLengths({ goal: text as string, constraints: '' })[0]).toMatchObject({ minimum, maximum })
})

it('uses explicit current revision feedback but never a historical progress claim as its requirement', () => {
  expect(explicitDeliveryLengths({ goal, constraints: '' }, '本次正文600至800字')).toEqual([{ quote: '本次正文600至800字', minimum: 600, maximum: 800, unit: '字' }])
})

it('honors an explicit one-off removal while keeping a negated removal and an input-reading bound out of it', () => {
  expect(explicitDeliveryLengths({ goal, constraints: '' }, '本次不限制字数')).toEqual([])
  expect(explicitDeliveryLengths({ goal, constraints: '' }, '本次不要取消字数限制')).toHaveLength(1)
  expect(explicitDeliveryLengths({ goal, constraints: '' }, '本次阅读资料不限制字数')).toHaveLength(1)
})

it('reuses a validated repair after reopening the store, preserving the candidate identity and task controls', async () => {
  const f = fixture(), original = parseDraft(JSON.stringify(draft(oversized)))
  const result = await enforceDeliveryLength(f.store, f.run, f.store.topics.get('writer', f.topicId), original, async () => correction(valid), new AbortController().signal, () => f.store.assertLive(f.run), parseDraft)
  f.reopen()
  const model = vi.fn(async () => { throw Error('must reuse') })
  const recovered = await enforceDeliveryLength(f.store, f.run, f.store.topics.get('writer', f.topicId), original, model, new AbortController().signal, () => f.store.assertLive(f.run), parseDraft)
  expect(recovered).toEqual(result)
  expect(recovered.delivery).toMatchObject({ completionCriteria: original.delivery!.completionCriteria, stages: original.delivery!.stages, section: { id: 'opening', title: '蓝灯之夜', body: valid } })
  expect(recovered.progress).toMatchObject({ status: 'researching', nextStep: '继续写灯塔故事' })
  expect(f.store.callCount('writer')).toBe(1)
  expect(model).not.toHaveBeenCalled()
})

it('rejects repair fields that try to change lifecycle or resources', async () => {
  const f = fixture()
  await f.runtime.execute(f.run, '', modelFor(oversized, async () => JSON.stringify({ ...JSON.parse(correction(valid)), progress: { status: 'completed' }, resourceBudget: { modelCalls: 500 } })), new AbortController().signal)
  expect(f.store.getRun(f.run)?.status).toBe('failed')
  expect(f.store.deliveries.get(f.topicId)?.sections ?? []).toEqual([])
})

it('rejects a late repair after the task has been paused', async () => {
  const f = fixture()
  await f.runtime.execute(f.run, '', modelFor(oversized, async () => { f.store.pause('writer'); return correction(valid) }), new AbortController().signal)
  expect(f.store.getRun(f.run)?.status).toBe('cancelled')
  expect(f.store.overview('writer').reports).toEqual([])
})

it('accepts the single complete repair object with surrounding model commentary, as in the live v8 failure', async () => {
  const f = fixture()
  await f.runtime.execute(f.run, '', modelFor(oversized, async () => `目录为空，下面修订同一候选。\n\n\`\`\`json\n${correction(valid)}\n\`\`\``), new AbortController().signal)
  expect(f.store.getRun(f.run)?.status).toBe('completed')
  expect(f.store.deliveries.get(f.topicId)?.sections[0].body).toBe(valid)
  expect(f.store.callCount('writer')).toBe(3)
})

it('rejects multiple complete repair candidates rather than choosing one', async () => {
  const f = fixture()
  await f.runtime.execute(f.run, '', modelFor(oversized, async () => `${correction(oversized)}\n${correction(valid)}`), new AbortController().signal)
  expect(f.store.getRun(f.run)?.status).toBe('failed')
  expect(f.store.overview('writer').reports).toEqual([])
})
