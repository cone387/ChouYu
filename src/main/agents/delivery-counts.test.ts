import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TaskCenter } from '../task-center/store'
import { WorkStrategyRuntime, parseDraft } from '../workloop/workflow'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { correctDeliveryCounts, invalidCountClaims } from './delivery-counts'
import { contactFailure } from '../../shared/contact-failure'

const cleanups: (() => void)[] = []
afterEach(() => cleanups.splice(0).reverse().forEach(fn => fn()))
const body = '灯'.repeat(400)
const candidate = { title: '蓝灯', body: '沈青抵达雾港，约480字。', memories: [], question: '',
  progress: { status: 'researching', judgement: '写出了抵达雾港的情节。', reason: '故事开篇', nextStep: '继续写作', openQuestions: '' },
  delivery: { completionCriteria: '持续写作', summary: '沈青抵达雾港。', stages: [{ id: 'story', title: '故事', status: 'active' }], section: { id: 'opening', title: '蓝灯', body } } }
function fixture(dailyCalls = 12) {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-counts-'))
  let store = new TaskCenter(join(dir, 'agents.db')), runtime = new WorkStrategyRuntime(store, join(dir, 'checkpoints.db'))
  cleanups.push(() => { runtime.close(); store.close(); rmSync(dir, { recursive: true, force: true }) })
  store.save('writer', { ...DEFAULT_AGENT_SETTINGS, goal: '持续写作灯塔故事，每轮300至500字', dailyCalls })
  return { get store() { return store }, get runtime() { return runtime }, topicId: store.overview('writer').focusTopicId!, run: store.createRun('writer', ''),
    reopen() { runtime.close(); store.close(); store = new TaskCenter(join(dir, 'agents.db')); runtime = new WorkStrategyRuntime(store, join(dir, 'checkpoints.db')); store.recover() } }
}

it('corrects a false writer count before committing while leaving the actual prose unchanged', async () => {
  const f = fixture()
  await f.runtime.execute(f.run, '', async prompt => {
    if (prompt.startsWith('为联系人')) return JSON.stringify({ action: 'write', reason: '开始写作', query: '', urls: [], checkAfterMinutes: 180 })
    if (prompt.startsWith('交付字数说明校正')) return JSON.stringify({ replacements: [{ field: 'body', text: '沈青抵达雾港。' }] })
    return JSON.stringify(candidate)
  }, new AbortController().signal)
  expect(f.store.getRun(f.run)?.status).toBe('completed')
  expect(f.store.detail('writer', f.run).report?.body).toBe('沈青抵达雾港。')
  expect(f.store.deliveries.get(f.topicId)?.sections[0].body).toBe(body)
  expect(f.store.callCount('writer')).toBe(3)
})

const counts = (n: number) => ({ 字: n, 汉字: n, 字符: n })
const facts = { current: counts(400), original: counts(512), total: counts(1800), sources: [{ number: 1, title: '作者开篇', url: 'contact-delivery://author/topic/opening?version=1', counts: counts(512) }] }
it.each(['沈青抵达雾港，约480字。', '本轮正文共480字。', '首次交付：沈青抵达雾港，约480字。'])('detects a self-report estimate: %s', text => {
  expect(invalidCountClaims(text, facts)).toEqual([{ claim: expect.any(String), scope: 'current', expected: 400 }])
})
it('binds an author count to the source, never to an accidentally matching review length', () => {
  expect(invalidCountClaims('首期评审：读取作者ch1_s1 v1《蓝灯之夜·抵达》约900字正文。', facts)).toEqual([{ claim: '约900字', scope: 'source', expected: 512 }])
  expect(invalidCountClaims('已读取作者400字正文。', facts)).toEqual([{ claim: '400字', scope: 'source', expected: 512 }])
})
it.each(['正文400字。', '原候选正文计512字，超出500字上限。', '全文累计1800字。', '下次目标约500字。', '每轮交付300至500字。', '信上写着“约900字”。', '正文包含一封约50字的信。'])('preserves a true count or a different meaning: %s', text => {
  expect(invalidCountClaims(text, facts)).toEqual([])
})
it('does not pick a convenient source when multiple sources have different counts', () => {
  const many = { ...facts, sources: [...facts.sources, { number: 2, title: '第二节', url: 'contact-delivery://author/topic/second?version=1', counts: counts(800) }] }
  expect(invalidCountClaims('原文约512字。', many)).toEqual([{ claim: '约512字', scope: 'source', expected: undefined }])
  expect(invalidCountClaims('原文[2]约800字。', many)).toEqual([])
})

it('uses the nearest explicit text scope and preserves a counted object within the story', () => {
  expect(invalidCountClaims('原候选正文512字，本轮正文400字。', facts)).toEqual([])
  expect(invalidCountClaims('原正文512字，修订后400字。', facts)).toEqual([])
  expect(invalidCountClaims('已读取作者原正文512字。', { ...facts, original: counts(600) })).toEqual([])
  expect(invalidCountClaims('原文512字，评审正文400字。', facts)).toEqual([])
  expect(invalidCountClaims('札记共8字。', facts)).toEqual([])
})

it('corrects the v7 reviewer summary using the read source without altering ratings or prose', async () => {
  const f = fixture(), source = readFileSync(new URL('./fixtures/oversized-opening.txt', import.meta.url), 'utf8')
  const evidence = [{ url: facts.sources[0].url, title: '蓝灯之夜·抵达', text: source, hash: 'fixed-source', capturedAt: 1 }]
  const draft = parseDraft(JSON.stringify({ ...candidate, evaluations: [{ subject: '蓝灯之夜', sourceNumbers: [1], dimensions: [{ name: '情节', score: 4, maxScore: 5, weight: 100, reason: '遗信与蓝灯形成悬念[1]' }], summary: '开篇悬念清楚', risks: '主角较被动', nextStep: '观察后续主动性' }],
    delivery: { ...candidate.delivery, summary: '首期评审：读取作者ch1_s1 v1《蓝灯之夜·抵达》约900字正文。感官细节扎实，主角较被动。' } }), 1)
  const corrected = await correctDeliveryCounts(f.store, f.run, f.store.topics.get('writer', f.topicId), draft, evidence, async () => JSON.stringify({ replacements: [{ field: 'delivery.summary', text: '已读取作者《蓝灯之夜·抵达》正文。感官细节扎实，主角较被动。' }] }), new AbortController().signal, () => f.store.assertLive(f.run), raw => parseDraft(raw, 1))
  expect(corrected.delivery!.section).toEqual(draft.delivery!.section)
  expect(corrected.evaluations).toEqual(draft.evaluations)
  expect(corrected.body).toEqual(draft.body)
  expect(corrected.delivery!.summary).not.toContain('900字')
  expect(JSON.parse(f.store.getRun(f.run)!.input).deliveryCountRepair.facts.sources[0].counts).toEqual({ 字: 512, 汉字: 512, 字符: 598 })
  expect(f.store.callCount('writer')).toBe(1)
})

it('reuses a validated metadata correction after a store restart', async () => {
  const f = fixture(), draft = parseDraft(JSON.stringify(candidate))
  const corrected = await correctDeliveryCounts(f.store, f.run, f.store.topics.get('writer', f.topicId), draft, [], async () => JSON.stringify({ replacements: [{ field: 'body', text: '沈青抵达雾港。' }] }), new AbortController().signal, () => f.store.assertLive(f.run), parseDraft)
  f.reopen()
  const model = vi.fn(async () => { throw Error('must not repeat') })
  expect(await correctDeliveryCounts(f.store, f.run, f.store.topics.get('writer', f.topicId), draft, [], model, new AbortController().signal, () => f.store.assertLive(f.run), parseDraft)).toEqual(corrected)
  expect(f.store.callCount('writer')).toBe(1)
  expect(model).not.toHaveBeenCalled()
})

it.each([
  { replacements: [{ field: 'body', text: '已交付约900字正文。' }] },
  { replacements: [{ field: 'delivery.section.body', text: '换掉原文' }] },
  { replacements: [{ field: 'body', text: '已交付正文。' }], resourceBudget: { modelCalls: 100 } }
])('rejects still-false statistics or changes outside the reporting fields', async response => {
  const f = fixture(), draft = parseDraft(JSON.stringify(candidate))
  await expect(correctDeliveryCounts(f.store, f.run, f.store.topics.get('writer', f.topicId), draft, [], async () => JSON.stringify(response), new AbortController().signal, () => f.store.assertLive(f.run), parseDraft)).rejects.toThrow('字数说明校正未通过')
  expect(f.store.overview('writer').reports).toEqual([])
  expect(JSON.parse(f.store.getRun(f.run)!.input).deliveryCountRepair.original.delivery.section.body).toBe(body)
})

it('does not retry a paid correction interrupted before its result was recorded', async () => {
  const f = fixture(), draft = parseDraft(JSON.stringify(candidate)), abort = new AbortController()
  await expect(correctDeliveryCounts(f.store, f.run, f.store.topics.get('writer', f.topicId), draft, [], async () => { abort.abort(); throw Error('worker interrupted') }, abort.signal, () => { abort.signal.throwIfAborted(); f.store.assertLive(f.run) }, parseDraft)).rejects.toThrow('worker interrupted')
  f.reopen()
  const model = vi.fn(async () => '')
  await expect(correctDeliveryCounts(f.store, f.run, f.store.topics.get('writer', f.topicId), draft, [], model, new AbortController().signal, () => f.store.assertLive(f.run), parseDraft)).rejects.toThrow('不再重复调用')
  expect(f.store.callCount('writer')).toBe(1)
  expect(model).not.toHaveBeenCalled()
})

it('describes the metadata failure and retained candidate without claiming delivery or automatic recovery', async () => {
  const f = fixture(), draft = parseDraft(JSON.stringify(candidate))
  try { await correctDeliveryCounts(f.store, f.run, f.store.topics.get('writer', f.topicId), draft, [], async () => '{}', new AbortController().signal, () => f.store.assertLive(f.run), parseDraft) }
  catch (error) { f.store.fail(f.run, String(error)) }
  expect(contactFailure(f.store.getRun(f.run)!.error)).toMatchObject({ kind: 'format', title: '交付字数说明未核实', settings: false })
  expect(f.store.decisions.failureImpact(f.run)).toContain('未交付草稿已保留')
})

it('adds no model call when reporting counts are correct', async () => {
  const f = fixture(), draft = parseDraft(JSON.stringify({ ...candidate, body: '本轮正文共400字。' }))
  const model = vi.fn(async () => { throw Error('unnecessary call') })
  expect(await correctDeliveryCounts(f.store, f.run, f.store.topics.get('writer', f.topicId), draft, [], model, new AbortController().signal, () => f.store.assertLive(f.run), parseDraft)).toBe(draft)
  expect(f.store.callCount('writer')).toBe(0)
  expect(model).not.toHaveBeenCalled()
})

it('does not expand the original daily allowance to repair a count', async () => {
  const f = fixture(2), draft = parseDraft(JSON.stringify(candidate))
  f.store.charge(f.run); f.store.charge(f.run)
  const model = vi.fn(async () => '')
  await expect(correctDeliveryCounts(f.store, f.run, f.store.topics.get('writer', f.topicId), draft, [], model, new AbortController().signal, () => f.store.assertLive(f.run), parseDraft)).rejects.toThrow('上限')
  expect(f.store.callCount('writer')).toBe(2)
  expect(model).not.toHaveBeenCalled()
})

it('does not accept a late metadata result after cancellation', async () => {
  const f = fixture(), draft = parseDraft(JSON.stringify(candidate))
  await expect(correctDeliveryCounts(f.store, f.run, f.store.topics.get('writer', f.topicId), draft, [], async () => {
    f.store.pause('writer'); return JSON.stringify({ replacements: [{ field: 'body', text: '沈青抵达雾港。' }] })
  }, new AbortController().signal, () => f.store.assertLive(f.run), parseDraft)).rejects.toThrow()
  expect(f.store.getRun(f.run)?.status).toBe('cancelled')
  expect(JSON.parse(f.store.getRun(f.run)!.input).deliveryCountRepair.corrected).toBeUndefined()
  expect(f.store.overview('writer').reports).toEqual([])
})

it('accepts a unique metadata object after commentary without accepting multiple objects', async () => {
  const f = fixture(), draft = parseDraft(JSON.stringify(candidate))
  const response = JSON.stringify({ replacements: [{ field: 'body', text: '沈青抵达雾港。' }] })
  const result = await correctDeliveryCounts(f.store, f.run, f.store.topics.get('writer', f.topicId), draft, [], async () => `下面核对字数。\n\`\`\`json\n${response}\n\`\`\``, new AbortController().signal, () => f.store.assertLive(f.run), parseDraft)
  expect(result.body).toBe('沈青抵达雾港。')
  expect(result.delivery!.section!.body).toBe(body)
  const other = fixture()
  await expect(correctDeliveryCounts(other.store, other.run, other.store.topics.get('writer', other.topicId), draft, [], async () => response + response, new AbortController().signal, () => other.store.assertLive(other.run), parseDraft)).rejects.toThrow('未通过')
})
