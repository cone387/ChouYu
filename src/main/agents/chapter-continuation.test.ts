import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentStore } from './store'
import { AgentRuntime, parseDraft } from './runtime'
import { DEFAULT_AGENT_SETTINGS, type AgentTopicProgress } from '../../shared/agents'
import { chapterTail, planChapterContinuation, validateChapterContinuation } from './chapter-continuation'
import { AgentOutputTruncatedError } from './model-output'

const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).reverse().forEach(fn => fn()))
const progress: AgentTopicProgress = { judgement: '已保存正文', reason: '延续情节', nextStep: '继续第一章下一节', openQuestions: '', status: 'researching' }
const plan = { action: 'write', reason: '续写小说', query: '', urls: [], checkAfterMinutes: 180 }
const update = (id: string, title: string, body: string) => ({ completionCriteria: '完成小说', summary: '人物已抵达塔内', stages: [{ id: 'draft', title: '小说初稿', status: 'active' as const }], section: { id, title, body } })
const draft = (id: string, title: string, body: string) => JSON.stringify({ title, body: '本轮新增正文', question: '', memories: [], progress, delivery: update(id, title, body) })
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'chapter-continuation-'))
  let store = new AgentStore(join(dir, 'agents.db'))
  let runtime = new AgentRuntime(store, join(dir, 'checkpoints.db'))
  cleanup.push(() => { runtime.close(); store.close(); rmSync(dir, { recursive: true, force: true }) })
  store.save('writer', { ...DEFAULT_AGENT_SETTINGS, goal: '续写长篇小说', dailyCalls: 48 })
  const topicId = store.overview('writer').focusTopicId!
  for (let n = 1; n <= 6; n++) {
    const runId = store.createRun('writer', '')
    store.finish(runId, { runId, title: '新增正文', body: '变化摘要', nextStep: progress.nextStep, evidence: [], createdAt: Date.now() }, [], progress, update(`ch1s${n}`, '第一章·塔内', '塔内传来脚步声。'.repeat(130)))
  }
  return { get store() { return store }, get runtime() { return runtime }, topicId, topic: () => store.topics.get('writer', topicId),
    reopen() { runtime.close(); store.close(); store = new AgentStore(join(dir, 'agents.db')); runtime = new AgentRuntime(store, join(dir, 'checkpoints.db')); store.recover() } }
}
const decision = { action: 'close', reason: '本章情节已充分展开，先完成脱险', beat: '离开塔内险地，以远方来信留下悬念', userLengthQuote: '', nextChapterAllowed: true, nextChapter: 2, nextVolume: null }

it('counts saved bodies by chapter and volume, not summary claims', () => {
  const section = (title: string, body: string) => ({ id: title, title, body, runId: 'run' })
  expect(chapterTail([section('第一卷 第一章·开始', '一'.repeat(9000)), section('第二卷 第一章·归来', '正文 \n'), section('第二卷 第1章·后续', '新正文')])).toMatchObject({ number: 1, volume: 2, characters: 5, sectionIds: ['第二卷 第一章·归来', '第二卷 第1章·后续'] })
  expect(chapterTail([section('不带章号的提纲', 'x'.repeat(9000))])).toBeUndefined()
})

it('closes oversized chapter then starts next chapter without rewriting saved sections', async () => {
  const f = fixture(), original = f.store.deliveries.get(f.topicId)!.sections
  const run = f.store.createRun('writer', '')
  const model = vi.fn(async (prompt: string) => {
    if (prompt.startsWith('为联系人')) return JSON.stringify(plan)
    if (prompt.startsWith('小说章节推进核对')) { expect(prompt).toContain('6240'); return JSON.stringify(decision) }
    expect(prompt).toContain('收尾本章')
    return draft('close1', '第一章·归途', '他走出了塔门。天际的来信为这一夜画上了句点。')
  })
  await f.runtime.execute(run, '', model, new AbortController().signal)
  expect(f.store.getRun(run)?.status).toBe('completed')
  expect(f.topic().nextStep).toContain('第2章')
  expect(f.topic().nextStep).not.toContain('继续第一章')
  f.reopen()
  const next = f.store.createRun('writer', '')
  await f.runtime.execute(next, '', async prompt => {
    if (prompt.startsWith('为联系人')) return JSON.stringify(plan)
    expect(prompt).toContain('开始下一章')
    return draft('ch2s1', '第二章·来信', '翌日清晨，他拆开了那封远方的来信。')
  }, new AbortController().signal)
  expect(f.store.getRun(next)?.status).toBe('completed')
  expect(f.store.deliveries.get(f.topicId)!.sections.slice(0, 6)).toEqual(original)
  expect(f.store.deliveries.get(f.topicId)!.sections.at(-1)?.title).toBe('第二章·来信')
})

it('rejects wrong chapter output without saving a renamed or duplicate section', async () => {
  const f = fixture(), run = f.store.createRun('writer', '')
  await f.runtime.execute(run, '', async prompt => prompt.startsWith('为联系人') ? JSON.stringify(plan)
    : prompt.startsWith('小说章节推进核对') ? JSON.stringify({ ...decision, action: 'advance' })
    : draft('wrong', '第一章·继续', '他继续向前走去。'), new AbortController().signal)
  expect(f.store.getRun(run)?.status).toBe('failed')
  expect(f.store.getRun(run)?.error).toContain('第2章')
  expect(f.store.deliveries.get(f.topicId)!.sections).toHaveLength(6)
})

it('caches review, does not count an uncommitted closing decision, and honors cancellation', async () => {
  const f = fixture(), run = f.store.createRun('writer', ''), model = vi.fn(async () => JSON.stringify(decision))
  const signal = new AbortController().signal, live = () => f.store.assertLive(run)
  const a = await planChapterContinuation(f.store, run, f.topic(), model, signal, live)
  expect(await planChapterContinuation(f.store, run, f.topic(), model, signal, live)).toEqual(a)
  expect(model).toHaveBeenCalledTimes(1)
  f.store.fail(run, '网络中断')
  const next = f.store.createRun('writer', '')
  const b = await planChapterContinuation(f.store, next, f.topic(), model, signal, () => f.store.assertLive(next))
  expect(b?.action).toBe('close')
  expect(model).toHaveBeenCalledTimes(1)
  const abort = new AbortController(); abort.abort()
  await expect(planChapterContinuation(f.store, next, f.topic(), model, abort.signal, () => {})).rejects.toThrow()
})

it('allows longer chapters only with an actual explicit user requirement', async () => {
  const f = fixture(), run = f.store.createRun('writer', '')
  await expect(planChapterContinuation(f.store, run, f.topic(), async () => JSON.stringify({ ...decision, action: 'continue', userLengthQuote: '每章两万字' }), new AbortController().signal, () => f.store.assertLive(run))).rejects.toThrow('章节')
})

it('skips chapter review when revising an existing section', async () => {
  const f = fixture(), run = f.store.createRun('writer', '')
  f.store.db.prepare("UPDATE runs SET input=json_set(input,'$.revisionSectionId','ch1s1') WHERE id=?").run(run)
  const model = vi.fn()
  expect(await planChapterContinuation(f.store, run, f.topic(), model, new AbortController().signal, () => f.store.assertLive(run))).toBeUndefined()
  expect(model).not.toHaveBeenCalled()
})

it('does not save a modern writing change summary when delivery is missing', async () => {
  const f = fixture(), run = f.store.createRun('writer', '')
  await f.runtime.execute(run, '', async prompt => prompt.startsWith('为联系人') ? JSON.stringify(plan)
    : prompt.startsWith('小说章节推进核对') ? JSON.stringify(decision)
    : JSON.stringify({ title: '第一章·新节', body: '已续写800字，主角离开塔内。', memories: [], question: '', progress }), new AbortController().signal)
  expect(f.store.getRun(run)?.status).toBe('failed')
  expect(f.store.deliveries.get(f.topicId)!.sections).toHaveLength(6)
})

it('waits on a necessary question without demanding unpublished prose, then honors the answer', async () => {
  const f = fixture(), run = f.store.createRun('writer', '')
  await f.runtime.execute(run, '', async prompt => prompt.startsWith('为联系人') ? JSON.stringify(plan)
    : prompt.startsWith('小说章节推进核对') ? JSON.stringify(decision)
    : JSON.stringify({ title: '确认设定', body: '结尾需要用户明确的设定。', question: '结尾来信的署名是什么？', memories: [], progress }), new AbortController().signal)
  expect(f.store.getRun(run)?.status).toBe('waiting')
  expect(f.store.deliveries.get(f.topicId)!.sections).toHaveLength(6)
  f.reopen(); f.store.answer('writer', run, '署名为林音；本任务只写第一章，不要开始第二章。')
  await f.runtime.execute(run, '', async prompt => {
    expect(prompt).toContain('不要开始第二章')
    if (prompt.startsWith('小说章节推进核对')) return JSON.stringify({ ...decision, nextChapterAllowed: false })
    return draft('ending', '第一章·归途', '他打开信封，落款只有两个字：林音。')
  }, new AbortController().signal)
  expect(f.store.getRun(run)?.status).toBe('completed')
  expect(f.topic().nextStep).toContain('不再添加章节')
})

it('preserves finite chapter scope and completion-review corrections', async () => {
  const f = fixture(), run = f.store.createRun('writer', '')
  const planned = await planChapterContinuation(f.store, run, { ...f.topic(), goal: '只写小说第一章' }, async () => JSON.stringify({ ...decision, nextChapterAllowed: false }), new AbortController().signal, () => f.store.assertLive(run))
  const result = validateChapterContinuation(parseDraft(draft('ending', '第一章·终', '天亮了。')), planned)
  expect(result.progress!.nextStep).toContain('不再添加章节')
  const reviewed = { ...result, nextStep: '核对第一章并润色', progress: { ...progress, nextStep: '核对第一章并润色' } }
  expect(validateChapterContinuation(reviewed, planned, false)).toEqual(reviewed)
  f.store.finish(run, { runId: run, title: '终', body: '新增结尾', nextStep: reviewed.nextStep, evidence: [], createdAt: Date.now() }, [], reviewed.progress, reviewed.delivery)
  expect(f.topic().nextStep).toBe('核对第一章并润色')
})

it('rechecks changed requirements after a committed close instead of forcing chapter two', async () => {
  const f = fixture(), run = f.store.createRun('writer', '')
  await planChapterContinuation(f.store, run, f.topic(), async () => JSON.stringify(decision), new AbortController().signal, () => f.store.assertLive(run))
  f.store.finish(run, { runId: run, title: '终', body: '新增结尾', nextStep: '开始第二章', evidence: [], createdAt: Date.now() }, [], progress, update('ending', '第一章·归途', '天亮了。'))
  const next = f.store.createRun('writer', ''), model = vi.fn(async () => JSON.stringify({ ...decision, nextChapterAllowed: false }))
  const result = await planChapterContinuation(f.store, next, { ...f.topic(), constraints: '只需第一章，补全结尾，不开始第二章' }, model, new AbortController().signal, () => f.store.assertLive(next))
  expect(model).toHaveBeenCalledTimes(1)
  expect(result).toMatchObject({ action: 'close', chapter: 1, nextChapterAllowed: false })
})

it('can start the next volume at chapter one and rejects skipped chapter numbers', async () => {
  const f = fixture(), run = f.store.createRun('writer', '')
  const result = await planChapterContinuation(f.store, run, { ...f.topic(), constraints: '第一卷共一章，接着写第二卷第一章' }, async () => JSON.stringify({ ...decision, action: 'advance', nextChapter: 1, nextVolume: 2 }), new AbortController().signal, () => f.store.assertLive(run))
  expect(result).toMatchObject({ action: 'advance', chapter: 1, volume: 2 })
  expect(() => validateChapterContinuation(parseDraft(draft('v2c1', '第二卷 第一章·来信', '清晨他拆开来信。')), result)).not.toThrow()
  expect(() => validateChapterContinuation(parseDraft(draft('v2c1', '第一章·来信', '清晨他拆开来信。')), result)).toThrow('第2卷')
  const next = f.store.createRun('writer', '')
  await expect(planChapterContinuation(f.store, next, f.topic(), async () => JSON.stringify({ ...decision, action: 'advance', nextChapter: 3 }), new AbortController().signal, () => f.store.assertLive(next))).rejects.toThrow('章节')
})

it('reuses the exact failed-run chapter decision so recovery context survives restart', async () => {
  const f = fixture(), run = f.store.createRun('writer', '')
  const first = await planChapterContinuation(f.store, run, f.topic(), async () => JSON.stringify(decision), new AbortController().signal, () => f.store.assertLive(run))
  f.store.fail(run, '生成中断'); f.reopen()
  const next = f.store.createRun('writer', ''), model = vi.fn(async () => JSON.stringify({ ...decision, beat: '另一个收尾' }))
  expect(await planChapterContinuation(f.store, next, f.topic(), model, new AbortController().signal, () => f.store.assertLive(next))).toEqual(first)
  expect(model).not.toHaveBeenCalled()
})

it('honors an explicit long chapter requirement and does not commit after cancellation', async () => {
  const f = fixture(), run = f.store.createRun('writer', '')
  const first = await planChapterContinuation(f.store, run, { ...f.topic(), constraints: '每章约8000字' }, async () => JSON.stringify({ ...decision, action: 'continue', userLengthQuote: '每章约8000字' }), new AbortController().signal, () => f.store.assertLive(run))
  expect(first?.action).toBe('continue')
  f.store.fail(run, '验收下一轮取消')
  const next = f.store.createRun('writer', ''), abort = new AbortController()
  await expect(planChapterContinuation(f.store, next, f.topic(), async () => { abort.abort(); return JSON.stringify(decision) }, abort.signal, () => f.store.assertLive(next))).rejects.toThrow()
  expect(JSON.parse(f.store.getRun(next)!.input).chapterContinuation).toBeUndefined()
})

it('resumes actual retained prose across a failed successor run with the same chapter decision', async () => {
  const f = fixture(), run = f.store.createRun('writer', '')
  await f.runtime.execute(run, '', async (prompt, _signal, options) => {
    if (prompt.startsWith('为联系人')) return JSON.stringify(plan)
    if (prompt.startsWith('小说章节推进核对')) return JSON.stringify(decision)
    if (options?.plainText) { options.onPartial?.('他终于走出塔门，'); throw new Error('网络中断') }
    throw new AgentOutputTruncatedError('{')
  }, new AbortController().signal)
  expect(f.store.getRun(run)?.status).toBe('failed')
  f.reopen()
  const next = f.store.createRun('writer', '')
  await f.runtime.execute(next, '', async (prompt, _signal, options) => {
    if (prompt.startsWith('为联系人')) return JSON.stringify(plan)
    expect(prompt).not.toMatch(/^小说章节推进核对/)
    if (options?.plainText) {
      expect(prompt).toContain('"savedPrefix":"他终于走出塔门，"')
      return '天际泛起晨光。[[SECTION_END]]'
    }
    expect(prompt).toContain('分段交付规则')
    return draft('ending', '第一章·归途', '__SAVED_BODY__')
  }, new AbortController().signal)
  expect(f.store.getRun(next)?.status).toBe('completed')
  expect(f.store.deliveries.get(f.topicId)!.sections.at(-1)?.body).toBe('他终于走出塔门，天际泛起晨光。')
})
