import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContactTaskStore } from '../task-center/contact-store'
import { WorkStrategyRuntime, parseDraft, type AgentModel } from '../workloop/workflow'
import { AgentOutputTruncatedError } from './model-output'
import { WritingRecovery } from './writing-recovery'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'

const cleanup: (() => void)[] = []
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close() })
function fixture(dailyCalls = 40) {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-draft-recovery-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  let store = new ContactTaskStore(join(dir, 'agents.db'))
  cleanup.push(() => store.close())
  store.save('writer', { ...DEFAULT_AGENT_SETTINGS, goal: '写音乐修炼小说', dailyCalls })
  let run = store.createRun('writer', '')
  const context = { nextStep: '第二章下半段', version: 3 }
  return {
    dir, get store() { return store }, get run() { return run },
    recovery: () => new WritingRecovery(store, run, context),
    reopen() {
      store.fail(run, '模拟停止')
      store.close(); store = new ContactTaskStore(join(dir, 'agents.db'))
      run = store.createRun('writer', '')
    }
  }
}
const metadata = JSON.stringify({ title: '第二章下半段', body: '完成一小节', nextStep: '继续第二章', memories: [], question: '',
  progress: { judgement: '交付试音情节', openQuestions: '', nextStep: '继续第二章', reason: '本轮小节已交付', status: 'researching' },
  delivery: { summary: '陆沉参加试音', completionCriteria: '完成整本小说', stages: [{ id: 'ch02', title: '第二章', status: 'active' }], section: { id: 'ch02b', title: '第二章下半段', body: '__SAVED_BODY__' } } })
const generate = (f: ReturnType<typeof fixture>, model: AgentModel) => f.recovery().generate(model, new AbortController().signal, {}, parseDraft, () => {})

it('extracts metadata for the same unpublished candidate instead of issuing the creation instruction again', async () => {
  const f = fixture(), body = '沈青第一次看见雾港的蓝灯。她记下这件事，决定下周四再去。'
  const model = vi.fn<AgentModel>(async (prompt, _signal, options) => {
    if (options?.plainText) return body + '[[SECTION_END]]'
    expect(prompt).not.toContain('生成进度')
    const data = JSON.parse(prompt.split('\n').at(-1)!)
    expect(data.candidate).toEqual({ published: false, body, counts: { 字: 25, 汉字: 25, 字符: 28 } })
    expect(prompt).toContain('不得推进到下一节')
    const value = JSON.parse(metadata)
    value.title = value.delivery.section.title = '第一章·蓝灯'
    value.delivery.summary = '沈青初见蓝灯，决定下周四再去。'
    value.progress.judgement = '本轮候选正文写到沈青记下蓝灯。'
    return JSON.stringify(value)
  })
  const result = parseDraft(await generate(f, model))
  expect(result.delivery?.section).toMatchObject({ title: '第一章·蓝灯', body })
  expect(result.delivery?.summary).not.toContain('第二章')
  expect(f.store.callCount('writer')).toBe(2)
})

it('starts the whole current section when the rejected structured response has no saved prose prefix', async () => {
  const f = fixture()
  f.recovery().retain('UNPUBLISHED_FIRST_SECTION：第一章已经完成，请从第二章开始。')
  const model = vi.fn<AgentModel>(async (prompt, _signal, options) => {
    if (!options?.plainText) return metadata
    // A failed structured output is diagnostic data, never the story's saved opening.
    expect(prompt).not.toContain('UNPUBLISHED_FIRST_SECTION')
    expect(prompt).not.toContain('previousAttempt')
    expect(prompt).toContain('从本小节开头')
    expect(prompt).toContain('"savedPrefix":""')
    return '沈青第一次抵达雾港。[[SECTION_END]]'
  })
  expect(parseDraft(await generate(f, model)).delivery?.section?.body).toBe('沈青第一次抵达雾港。')
})

it('isolates leaked recovery commentary and regenerates without publishing or continuing it', async () => {
  const f = fixture(), leaked = '目录为空，但 previousAttempt 中已有第一段完整正文。按指令“分段创作恢复”，从其结尾续写。'
  let attempts = 0
  const model = vi.fn<AgentModel>(async (prompt, _signal, options) => {
    if (!options?.plainText) return metadata
    if (++attempts === 1) return leaked + '\n第二天的正文。[[SECTION_END]]'
    expect(prompt).not.toContain(leaked)
    expect(prompt).toContain('"savedPrefix":""')
    return '沈青第一次抵达雾港。[[SECTION_END]]'
  })
  const output = parseDraft(await generate(f, model))
  expect(output.delivery?.section?.body).toBe('沈青第一次抵达雾港。')
  expect(model).toHaveBeenCalledTimes(3)
  expect(f.store.callCount('writer')).toBe(3)
  expect(f.store.overview('writer').reports).toEqual([])
})

it('never promotes a complete legacy scratch containing protocol commentary after restart', async () => {
  const f = fixture(), leaked = '目录为空，但 previousAttempt 中已有第一段完整正文。'
  // Seed the previously accepted on-disk shape, not the new generator's validation path.
  f.recovery().retain('old diagnostics')
  f.store.db.prepare("UPDATE writing_drafts SET value=json_set(value,'$.body',?,'$.complete',json('true'))").run(leaked)
  f.reopen()
  const model = vi.fn<AgentModel>(async (_prompt, _signal, options) => options?.plainText ? leaked + '[[SECTION_END]]' : metadata)
  await expect(generate(f, model)).rejects.toThrow('恢复次数')
  expect(model).toHaveBeenCalledTimes(3)
  expect(f.recovery().read()?.complete).toBe(false)
  expect(f.recovery().read()?.body).toBe('')
  expect(f.store.overview('writer').reports).toEqual([])
})

it('reports only the failed attempt’s saved draft, not old scratch from another attempt', async () => {
  const f = fixture()
  await expect(generate(f, async (_prompt, _signal, options) => {
    options?.onPartial?.('这次中断前已保存的草稿')
    throw new Error('network failure')
  })).rejects.toThrow('network failure')
  f.store.fail(f.run, 'network failure')
  expect(f.store.decisions.pending('writer')[0].impact).toContain('未交付草稿')
  const later = f.store.createRun('writer', '')
  f.store.fail(later, '资料不在本轮目录快照内')
  expect(f.store.decisions.pending('writer')[0].impact).not.toContain('未交付草稿')
})

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

it('does not publish the saved prefix twice when the continuation echoes the full prefix', async () => {
  const f = fixture(), prefix = '沈青抵达雾港，望着灯塔记下当晚的经过。'.repeat(6)
  let calls = 0
  const model: AgentModel = async (_prompt, _signal, options) => {
    if (!options?.plainText) return metadata
    if (++calls === 1) return prefix
    options.onPartial?.(prefix.slice(0, 50))
    options.onPartial?.(prefix + '她决定次日再来。')
    return prefix + '她决定次日再来。[[SECTION_END]]'
  }
  expect(parseDraft(await generate(f, model)).delivery?.section?.body).toBe(prefix + '她决定次日再来。')
})

it('retains an echoed continuation only once across interruption and database reopen', async () => {
  const f = fixture(), prefix = '沈青抵达雾港，望着灯塔记下当晚的经过。'.repeat(6)
  let calls = 0
  await expect(generate(f, async (_prompt, _signal, options) => {
    if (++calls === 1) return prefix
    options?.onPartial?.(prefix + '她决定')
    throw new Error('network failure')
  })).rejects.toThrow('network failure')
  expect(f.recovery().read()?.body).toBe(prefix + '她决定')
  f.reopen()
  const result = await generate(f, async (_prompt, _signal, options) => options?.plainText ? '次日再来。[[SECTION_END]]' : metadata)
  expect(parseDraft(result).delivery?.section?.body).toBe(prefix + '她决定次日再来。')
})

it('keeps a short interrupted continuation that happens to start like the saved prefix', async () => {
  const f = fixture(), prefix = '沈青抵达雾港，望着灯塔记下当晚的经过。'.repeat(6)
  let calls = 0
  await expect(generate(f, async (_prompt, _signal, options) => {
    if (++calls === 1) return prefix
    options?.onPartial?.('沈青')
    throw new Error('network failure')
  })).rejects.toThrow('network failure')
  expect(f.recovery().read()?.body).toBe(prefix + '沈青')
})

it('flushes the corrected draft when a streamed prefix replay ends in an interruption', async () => {
  const f = fixture(), prefix = '沈青抵达雾港，望着灯塔记下当晚的经过。'.repeat(6)
  let calls = 0
  const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now())
  try {
    await expect(generate(f, async (_prompt, _signal, options) => {
      if (++calls === 1) return prefix
      options?.onPartial?.(prefix.slice(0, 50))
      options?.onPartial?.(prefix)
      throw new Error('network failure')
    })).rejects.toThrow('network failure')
    expect(f.recovery().read()?.body).toBe(prefix)
  } finally { now.mockRestore() }
})

it('does not charge a partially replayed long prefix against the section size limit twice', async () => {
  const f = fixture(), prefix = '沈青抵达雾港，望着灯塔记下当晚的经过。'.repeat(350)
  let calls = 0
  const result = await generate(f, async (_prompt, _signal, options) => {
    if (!options?.plainText) return metadata
    if (++calls === 1) return prefix
    options.onPartial?.(prefix.slice(0, 4000))
    options.onPartial?.(prefix + '她决定次日再来。')
    return prefix + '她决定次日再来。[[SECTION_END]]'
  })
  expect(parseDraft(result).delivery?.section?.body).toBe(prefix + '她决定次日再来。')
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
  const f = fixture(), runtime = new WorkStrategyRuntime(f.store, join(f.dir, 'checkpoints.db'))
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
