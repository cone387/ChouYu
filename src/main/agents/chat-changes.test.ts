import { describe, expect, it, vi } from 'vitest'
import { routeContactChange } from './chat-changes'
import { contactConversation } from './conversation'
import { waitForToolApproval } from '../tool-approval'
import { createContactTools } from './tools'
import type { ToolExecutionContext } from '../tools/registry'

function fixture(plan: unknown) {
  const data = { topics: [{ id: 't', revision: 4, title: '评审', goal: '可以一次评价1–3个 idea', constraints: '' }], runs: [{ id: 'r', topicId: 't', status: 'waiting' }], focusTopicId: 't' }
  const read = vi.fn(async (method: string) => method === 'get' ? data : { version: 7 })
  const model = vi.fn(async () => JSON.stringify(plan))
  const execute = vi.fn(async (_call: any) => JSON.stringify({ saved: true, message: '新要求已保存', workCompleted: false, requestAccepted: true }))
  const run = (message = '一次汇报一个就行了，可以吗') => routeContactChange([{ role: 'user', content: message }], { read, model, execute })
  return { data, read, model, execute, run }
}
describe('contact chat routing and receipts', () => {
  it.each(['running', 'waiting'])('returns an unchanged result if work becomes %s during tool preparation', async status => {
    const f = fixture({ kind: 'action', topicId: 't', action: 'continue', targetText: '评审' })
    f.data.runs = []
    const request = vi.fn(async (method: string) => {
      if (method !== 'get') throw new Error('Must not write or create another round')
      return { ...f.data, runs: [{ id: 'r', topicId: 't', status, question: '原问题仍在等回复' }] }
    })
    const tools = createContactTools({ owner: () => 'alice', request })
    f.execute.mockImplementation(async call => {
      const prepared = await tools.find(t => t.name === call.name)!.prepareAsync!(JSON.parse(call.arguments), { sessionId: 'chat' } as ToolExecutionContext)
      expect(prepared).toHaveProperty('noOpResult')
      return (await prepared.execute()).content
    })
    const reply = await f.run('继续评审')
    expect(reply).toContain(status === 'running' ? '正在执行' : '原问题仍在等回复')
    expect(reply).not.toMatch(/已提交|失败/)
    expect(request).toHaveBeenCalledExactlyOnceWith('get', 'alice')
  })
  it.each([
    ['running', '正在执行'], ['queued', '排队'], ['interrupted', '等待恢复'], ['waiting', '你熟悉哪个行业？']
  ])('reports the actual %s state without attempting a duplicate continuation', async (status, expected) => {
    const f = fixture({ kind: 'action', topicId: 't', action: 'continue', targetText: '评审' })
    Object.assign(f.data.runs[0], { status, question: status === 'waiting' ? '你熟悉哪个行业？' : '' })
    const reply = await f.run('继续评审')
    expect(reply).toContain(expected)
    expect(reply).not.toMatch(/失败|回答问题工具/)
    expect(f.execute).not.toHaveBeenCalled()
  })
  it('does not attach an explicitly different book to the only existing task', async () => {
    const f = fixture({ kind: 'action', topicId: 't', action: 'continue', targetText: '吞噬星空续' })
    f.data.topics[0].title = '写一本音乐修炼题材的玄幻小说'
    f.data.runs[0].status = 'running'
    const reply = await f.run('我说的是继续写吞噬星空续')
    expect(reply).toContain('没有找到')
    expect(reply).toContain('吞噬星空续')
    expect(f.execute).not.toHaveBeenCalled()
  })
  it('does not trust an empty target when the user names a different book', async () => {
    const f = fixture({ kind: 'action', topicId: 't', action: 'continue', targetText: '' })
    f.data.topics[0].title = '写一本音乐修炼题材的玄幻小说'
    expect(await f.run('我说的是继续写吞噬星空续')).toContain('任务名称')
    expect(f.execute).not.toHaveBeenCalled()
  })
  it('recovers a missing extraction from an exact task title in a simple continuation', async () => {
    const f = fixture({ kind: 'action', topicId: 't', action: 'continue', targetText: '' })
    f.data.runs[0].status = 'running'
    expect(await f.run('继续评审')).toContain('正在执行')
    expect(await f.run('继续评审，不是音乐小说')).toContain('任务名称')
    expect(f.execute).not.toHaveBeenCalled()
  })
  it.each([['running', 'completed'], ['completed', 'running']])('uses fresh state after model latency: %s to %s', async (before, after) => {
    const plan = { kind: 'action', topicId: 't', action: 'continue', targetText: '评审' }
    const f = fixture(plan)
    f.read.mockResolvedValueOnce({ ...f.data, runs: [{ id: 'r', topicId: 't', status: before }] })
    f.data.runs[0].status = after
    const reply = await f.run('继续评审')
    if (after === 'completed') { expect(reply).toContain('已提交'); expect(f.execute).toHaveBeenCalledOnce() }
    else { expect(reply).toContain('正在执行'); expect(f.execute).not.toHaveBeenCalled() }
  })
  it('rejects invented target evidence and repairs missing target evidence before continuing', async () => {
    const f = fixture({ kind: 'action', topicId: 't', action: 'continue', targetText: '评审' })
    expect(await f.run('继续写小说')).toContain('任务名称')
    expect(f.execute).not.toHaveBeenCalled()
    f.data.runs = []
    f.model.mockResolvedValueOnce(JSON.stringify({ kind: 'action', topicId: 't', action: 'continue' }))
    expect(await f.run('继续评审')).toContain('已提交')
    expect(f.model).toHaveBeenCalledTimes(3)
  })
  it('keeps a continue request blocked without a failure reply, then resumes the same operation', async () => {
    vi.useFakeTimers()
    try {
      const f = fixture({ kind: 'action', topicId: 't', action: 'continue', targetText: '' })
      f.data.runs = []
      let approve!: (approved: boolean) => void
      const resume = vi.fn(() => JSON.stringify({ workCompleted: false, message: '已继续' }))
      f.execute.mockImplementation(async () => {
        const outcome = await waitForToolApproval(new AbortController().signal, respond => { approve = respond; return () => {} })
        if (outcome !== 'approved') throw new Error(`Unexpected outcome: ${outcome}`)
        return resume()
      })
      const reply = vi.fn(), pending = f.run('嗯，继续续写').then(reply)
      await vi.advanceTimersByTimeAsync(24 * 60 * 60_000)
      expect(f.execute).toHaveBeenCalledOnce()
      expect(resume).not.toHaveBeenCalled()
      expect(reply).not.toHaveBeenCalled()
      approve(true)
      await pending
      expect(resume).toHaveBeenCalledOnce()
      expect(reply).toHaveBeenCalledWith('已提交继续执行，尚未产生新成果。')
      expect(JSON.parse(f.execute.mock.calls[0][0].arguments)).toMatchObject({ topicId: 't', revision: 4, action: 'continue' })
    } finally { vi.useRealTimers() }
  })
  it.each([
    ['汇报单位', { constraints: '每条交付只含一个 idea，不限制研究批次' }],
    ['汇报语言', { constraints: '之后用中文汇报，保留依据' }],
    ['目标范围', { goal: '只评价面向个人的产品，保留现有评分标准' }],
    ['任务改名', { title: '个人产品评审' }],
    ['任务调用上限', { modelCalls: 500 }],
    ['任务Token上限', { tokens: 300000 }],
    ['同任务联合修改', { constraints: '先给结论', modelCalls: 600, tokens: 500000 }],
    ['明确清除约束', { constraints: '' }]
  ])('%s routes to the original version and forwards only changed fields', async (_, patch) => {
    const f = fixture({ kind: 'action', topicId: 't', action: 'edit', patch, reason: '模型改写的原话' })
    expect(await f.run()).toBe('新要求已保存')
    expect(f.execute).toHaveBeenCalledTimes(1)
    expect(f.execute.mock.calls[0]![0]).toMatchObject({ name: 'edit_contact_task' })
    expect(JSON.parse((f.execute.mock.calls[0] as any)[0].arguments)).toEqual({ topicId: 't', revision: 4, reason: '一次汇报一个就行了，可以吗', ...patch })
  })
  it.each(['pause', 'continue', 'revise', 'answer', 'presentation'])('routes %s using actual persisted identity', async action => {
    const f = fixture({ kind: 'action', topicId: 't', action, runId: 'r', targetText: '' })
    if (action === 'continue') f.data.runs = []
    await f.run(action === 'continue' ? '继续吧' : '我的明确要求')
    const call = (f.execute.mock.calls[0] as any)[0], args = JSON.parse(call.arguments)
    expect(args).toMatchObject({ topicId: 't', revision: 4 })
    if (action === 'answer') expect(args.answer).toBe('我的明确要求')
    if (action === 'presentation') expect(args.deliveryVersion).toBe(7)
  })
  it.each(['普通讨论', '不需要修改', '引用别人说：暂停任务', '进度如何', '新建一个其他任务'])('does not mutate when classified as ordinary chat: %s', async message => {
    const f = fixture({ kind: 'none' }); expect(await f.run(message)).toBeUndefined(); expect(f.execute).not.toHaveBeenCalled()
  })
  it('returns clarification or unsupported capability without a write', async () => {
    const f = fixture({ kind: 'question', message: '你指哪一个任务？本次未修改。' })
    expect(await f.run()).toContain('哪一个'); expect(f.execute).not.toHaveBeenCalled()
  })
  it('does not let a guessed focus task authorize an ambiguous multi-task change', async () => {
    const f = fixture({ kind: 'action', topicId: 't', action: 'edit', patch: { constraints: '中文' } })
    f.data.topics.push({ ...f.data.topics[0], id: 'other', title: '小说' })
    expect(await f.run('把那个任务改成中文')).toContain('任务名称'); expect(f.execute).not.toHaveBeenCalled()
    expect(await f.run('把评审改成中文')).toBe('新要求已保存')
  })
  it.each(['schedule'])('rejects obsolete unsupported %s responses instead of claiming a supported feature is missing', async capability => {
    const f = fixture({ kind: 'unsupported', capability }); await expect(f.run()).rejects.toThrow('没有识别'); expect(f.execute).not.toHaveBeenCalled()
  })
  it.each([
    { kind: 'action', topicId: 'foreign', action: 'pause' },
    { kind: 'action', topicId: 't', action: 'invented-action' },
    { kind: 'action', topicId: 't', action: 'answer', runId: 'wrong' },
    { kind: 'action', topicId: 't', action: 'edit', patch: { dailyCalls: 500 } },
    { kind: 'action', topicId: 't', action: 'edit', patch: { topicId: 'foreign' } },
    { kind: 'garbage' }
  ])('rejects invalid routes before execution', async plan => {
    const f = fixture(plan); await expect(f.run()).rejects.toThrow(); expect(f.execute).not.toHaveBeenCalled()
  })
  it('does not replace errors, refusal or disabled-tool results with a success promise', async () => {
    for (const response of ['工具执行失败：磁盘已满', '工具已被用户禁用', '用户拒绝了本次操作']) {
      const f = fixture({ kind: 'action', topicId: 't', action: 'edit', patch: { constraints: '一条一个' } })
      f.execute.mockResolvedValue(response)
      expect(await f.run()).toBe(`这次调整没有完成。${response}`)
    }
  })
  it('fails closed on malformed model output and never falls back to free-form promises', async () => {
    const f = fixture({}); f.model.mockResolvedValue('好的，以后一次一个')
    await expect(f.run()).rejects.toThrow('本次未修改'); expect(f.execute).not.toHaveBeenCalled()
    expect(f.model).toHaveBeenCalledTimes(2)
  })
  it('repairs a malformed numeric budget once before any execution', async () => {
    const f = fixture({ kind: 'action', topicId: 't', action: 'edit', patch: { tokens: 300000 } })
    f.model.mockResolvedValueOnce(JSON.stringify({ kind: 'action', topicId: 't', action: 'edit', patch: { tokens: '累计30万' } }))
    await f.run('任务累计Token改为30万')
    expect(f.model).toHaveBeenCalledTimes(2); expect(f.execute).toHaveBeenCalledTimes(1)
    expect(JSON.parse(f.execute.mock.calls[0][0].arguments).tokens).toBe(300000)
  })
  it('rejects missing receipts instead of claiming success', async () => {
    const f = fixture({ kind: 'action', topicId: 't', action: 'edit', patch: { constraints: '一个' } })
    f.execute.mockResolvedValue('{}'); await expect(f.run()).rejects.toThrow('回执')
  })
})
it('keeps the newest actual conversation across sessions, excluding automatic reports', () => {
  const messages = Array.from({ length: 30 }, (_, i) => ({ role: 'assistant', content: '长成果'.repeat(2000), timestamp: i, agentNotice: {} }))
  const result = contactConversation([...messages, { role: 'user', content: '一次汇报一个', timestamp: 100 } as any, { role: 'assistant', content: '旧回复'.repeat(3000), timestamp: 40 } as any])
  expect(result).toContain('user: 一次汇报一个'); expect(result).not.toContain('长成果'); expect(result.length).toBeLessThanOrEqual(4000)
})
