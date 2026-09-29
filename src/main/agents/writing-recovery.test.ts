import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentStore } from './store'
import { AgentRuntime, parseDraft, type AgentModel } from './runtime'
import { AgentOutputTruncatedError } from './model-output'
import { WritingRecovery } from './writing-recovery'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'

const cleanup: (() => void)[] = []
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close() })
function fixture(dailyCalls = 40) {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-draft-recovery-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  let store = new AgentStore(join(dir, 'agents.db'))
  cleanup.push(() => store.close())
  store.save('writer', { ...DEFAULT_AGENT_SETTINGS, goal: '写音乐修炼小说', dailyCalls })
  let run = store.createRun('writer', '')
  const context = { nextStep: '第二章下半段', version: 3 }
  return {
    dir, get store() { return store }, get run() { return run },
    recovery: () => new WritingRecovery(store, run, context),
    reopen() {
      store.fail(run, '模拟停止')
      store.close(); store = new AgentStore(join(dir, 'agents.db'))
      run = store.createRun('writer', '')
    }
  }
}
const metadata = JSON.stringify({ title: '第二章下半段', body: '完成一小节', nextStep: '继续第二章', memories: [], question: '',
  progress: { judgement: '交付试音情节', openQuestions: '', nextStep: '继续第二章', reason: '本轮小节已交付', status: 'researching' },
  delivery: { summary: '陆沉参加试音', completionCriteria: '完成整本小说', stages: [{ id: 'ch02', title: '第二章', status: 'active' }], section: { id: 'ch02b', title: '第二章下半段', body: '__SAVED_BODY__' } } })
const generate = (f: ReturnType<typeof fixture>, model: AgentModel) => f.recovery().generate(model, new AbortController().signal, {}, '生成进度', parseDraft, () => {})

it('continues truncated prose and assembles metadata without regenerating the body', async () => {
  const f = fixture()
  let proseCalls = 0
  const model = vi.fn<AgentModel>(async (prompt, _signal, options) => {
    if (!options?.plainText) return metadata
    if (++proseCalls === 1) { options.onPartial?.('陆沉拨响'); throw new AgentOutputTruncatedError('陆沉拨响') }
    expect(prompt).toContain('"savedPrefix":"陆沉拨响"')
    expect(prompt).toContain('最多200字')
    return '第一弦。\n[[SECTION_END]]'
  })
  const result = parseDraft(await generate(f, model))
  expect(result.delivery?.section?.body).toBe('陆沉拨响第一弦。')
  expect(model).toHaveBeenCalledTimes(3)
  expect(f.store.callCount('writer')).toBe(3)
  expect(f.store.overview('writer').reports).toEqual([])
})

it('bounds continuous truncation and resumes the persisted prefix after reopening the database', async () => {
  const f = fixture()
  const truncated = vi.fn<AgentModel>(async () => { throw new AgentOutputTruncatedError('接续') })
  await expect(generate(f, truncated)).rejects.toThrow('草稿已保留')
  expect(truncated).toHaveBeenCalledTimes(3)
  expect(f.recovery().read()?.body).toBe('接续接续接续')
  f.reopen()
  const resumed = vi.fn<AgentModel>(async (prompt, _signal, options) => {
    if (!options?.plainText) return metadata
    expect(prompt).toContain('接续接续接续')
    return '收束。[[SECTION_END]]'
  })
  expect(parseDraft(await generate(f, resumed)).delivery?.section?.body).toBe('接续接续接续收束。')
  expect(resumed).toHaveBeenCalledTimes(2)
})

it('keeps complete prose when metadata fails and retries only metadata on the next round', async () => {
  const f = fixture()
  await expect(generate(f, async (_prompt, _signal, options) => options?.plainText ? '已完成正文。[[SECTION_END]]' : '{')).rejects.toThrow('进度信息恢复仍未通过')
  f.reopen()
  const model = vi.fn<AgentModel>(async (_prompt, _signal, options) => { expect(options?.plainText).not.toBe(true); return metadata })
  expect(parseDraft(await generate(f, model)).delivery?.section?.body).toBe('已完成正文。')
  expect(model).toHaveBeenCalledTimes(1)
})

it('preserves a received prefix after network failure and isolates changed task scopes', async () => {
  const f = fixture()
  await expect(generate(f, async (_prompt, _signal, options) => {
    options?.onPartial?.('网络中断前的正文')
    throw new Error('网络断开')
  })).rejects.toThrow('草稿已保留')
  expect(f.recovery().read()?.body).toBe('网络中断前的正文')
  expect(new WritingRecovery(f.store, f.run, { nextStep: '修改第一章' }).read()).toBeUndefined()
})

it('stops before an unbudgeted call and retains complete prose', async () => {
  const f = fixture(2)
  f.store.charge(f.run)
  const model = vi.fn<AgentModel>(async () => '预算内正文。[[SECTION_END]]')
  await expect(generate(f, model)).rejects.toThrow('上限')
  expect(model).toHaveBeenCalledTimes(1)
  expect(f.recovery().read()?.complete).toBe(true)
  expect(f.store.callCount('writer')).toBe(2)
})

it('recovers an actual runtime write truncation and commits one complete deliverable', async () => {
  const f = fixture(), runtime = new AgentRuntime(f.store, join(f.dir, 'checkpoints.db'))
  cleanup.push(() => runtime.close())
  let writes = 0
  await runtime.execute(f.run, '', async (prompt, _signal, options) => {
    if (prompt.startsWith('为联系人')) return JSON.stringify({ action: 'write', reason: '继续小说', query: '', urls: [], checkAfterMinutes: 180 })
    if (options?.plainText) return '陆沉拨响第一弦。[[SECTION_END]]'
    if (++writes === 1) throw new AgentOutputTruncatedError('{"delivery":')
    return metadata
  }, new AbortController().signal)
  expect(f.store.detail('writer', f.run).run.status).toBe('completed')
  expect(f.store.overview('writer').reports).toHaveLength(1)
  const saved = f.store.deliveries.get(f.store.overview('writer').focusTopicId!)
  expect(saved?.sections).toHaveLength(1)
  expect(saved?.sections[0].body).toBe('陆沉拨响第一弦。')
})
