import { afterEach, describe, expect, it, vi } from 'vitest'
import { CompanionBriefing } from './companion'
type Deps = ConstructorParameters<typeof CompanionBriefing>[0]

function fixture() {
  let stored: string | undefined
  const receipts = new Set<string>()
  const evidence = { checkedAt: '2026-10-09T01:00:00Z', timeZone: 'Asia/Shanghai', contacts: [{
    id: 'writer', name: '阿笔', omittedTopics: 0,
    topics: [{ id: 'novel', revision: 1, title: '小说', status: 'paused' as const, judgement: '已保存两章', reason: '预算已用 6/6 次', nextStep: '继续第三章', updatedAt: 1 }],
    runs: [{ topicId: 'novel', status: 'waiting' as const, question: '第三章用哪个视角？', error: '', summary: '' }],
    queuedTopicIds: [], reports: [], latestActivity: undefined
  }] }
  const deps = {
    read: () => stored, write: vi.fn((value: string) => { stored = value }),
    enabled: vi.fn(() => true), allowed: vi.fn(() => true),
    inspect: vi.fn<Deps['inspect']>(async () => structuredClone(evidence)),
    summarize: vi.fn<Deps['summarize']>(async () => '阿笔在等你确定第三章的视角。'),
    deliver: vi.fn<Deps['deliver']>(p => { receipts.add(p.receipt) }),
    delivered: (receipt: string) => receipts.has(receipt)
  }
  return { deps, evidence, receipts, service: new CompanionBriefing(deps), saved: () => JSON.parse(stored!) }
}
afterEach(() => vi.useRealTimers())
describe('companion work checks', () => {
  it('does not leak internal progress through the deterministic link list or failure fallback', async () => {
    const f = fixture()
    Object.assign(f.evidence.contacts[0].topics[0], { status: 'researching', judgement: 'arc2ch04a转done', reason: 'field active', nextStep: 'nextStep=arc2ch05a' })
    Object.assign(f.evidence.contacts[0].runs[0], { status: 'completed', question: '', error: '' })
    f.deps.summarize.mockRejectedValue(new Error('offline'))
    await f.service.send('greeting', 'no-log')
    const content = f.deps.deliver.mock.calls[0][0].content
    expect(content).toContain('#contact-task')
    expect(content).toContain('整理失败')
    expect(content).not.toMatch(/arc2ch|active|done|nextStep/)
  })
  it('checks before greeting, includes verified task links, and shares its baseline with returns', async () => {
    const f = fixture()
    await f.service.send('greeting', 'day1')
    expect(f.deps.deliver.mock.calls[0][0]).toMatchObject({ content: expect.stringContaining('不代表今天新增') })
    expect(f.deps.deliver.mock.calls[0][0]).toMatchObject({ content: expect.stringContaining('#contact-task?characterId=writer&topicId=novel') })
    await f.service.send('return', 'return1')
    expect(f.deps.summarize).toHaveBeenCalledTimes(1)
    expect(f.deps.deliver.mock.calls[1][0]).toMatchObject({ content: expect.stringContaining('没有新的变化') })
    expect(f.deps.deliver.mock.calls[1][0]).toMatchObject({ content: expect.not.stringContaining('第三章用哪个视角') })
  })
  it('reports changed questions even when a topic timestamp stays the same', async () => {
    const f = fixture()
    await f.service.send('greeting', 'a')
    f.evidence.contacts[0].runs[0].question = '结局用哪一个？'
    await f.service.send('return', 'b')
    expect(f.deps.summarize).toHaveBeenCalledTimes(2)
    expect(f.deps.deliver.mock.calls[1][0]).toMatchObject({ content: expect.stringContaining('结局用哪一个') })
  })
  it('serializes duplicate requests and keeps durable deduplication after restart', async () => {
    const f = fixture()
    await Promise.all([f.service.send('greeting', 'a'), f.service.send('greeting', 'a')])
    await new CompanionBriefing(f.deps).send('greeting', 'a')
    expect(f.deps.deliver).toHaveBeenCalledTimes(1)
    expect(f.deps.summarize).toHaveBeenCalledTimes(1)
  })
  it('reuses persisted content after a failed delivery without advancing the baseline early', async () => {
    const f = fixture()
    f.deps.deliver.mockImplementationOnce(() => { throw new Error('disk full') })
    await expect(f.service.send('greeting', 'a')).rejects.toThrow('disk full')
    expect(f.saved().hashes).toEqual({})
    expect(f.saved().pending.content).toContain('第三章')
    await new CompanionBriefing(f.deps).retryPending()
    expect(f.deps.summarize).toHaveBeenCalledTimes(1)
    expect(f.saved().pending).toBeUndefined()
    expect(Object.keys(f.saved().hashes)).toHaveLength(1)
  })
  it('keeps state facts and a clear failure notice when the model fails', async () => {
    const f = fixture()
    f.deps.summarize.mockRejectedValue(new Error('network'))
    await f.service.send('greeting', 'a')
    expect(f.deps.deliver.mock.calls[0][0]).toMatchObject({ content: expect.stringContaining('模型整理失败') })
    expect(f.deps.deliver.mock.calls[0][0]).toMatchObject({ content: expect.stringContaining('第三章用哪个视角') })
  })
  it('does not read work or call the model when tools are disabled', async () => {
    const f = fixture()
    f.deps.allowed.mockReturnValue(false)
    await f.service.send('greeting', 'a')
    expect(f.deps.inspect).not.toHaveBeenCalled()
    expect(f.deps.summarize).not.toHaveBeenCalled()
    expect(f.deps.deliver.mock.calls[0][0]).toMatchObject({ content: expect.stringContaining('没有检查工作') })
  })
  it('discards a late response after the duty is disabled', async () => {
    const f = fixture()
    f.deps.summarize.mockImplementation(async () => { f.deps.enabled.mockReturnValue(false); return 'late' })
    await f.service.send('greeting', 'a')
    expect(f.deps.deliver).not.toHaveBeenCalled()
    expect(f.deps.write).not.toHaveBeenCalled()
  })
  it('bounds a hung check and does not advance per-task state', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.deps.inspect.mockImplementation(() => new Promise(() => {}))
    const pending = f.service.send('greeting', 'a')
    await vi.advanceTimersByTimeAsync(45_001)
    await pending
    expect(f.deps.deliver.mock.calls[0][0]).toMatchObject({ content: expect.stringContaining('失败或超时') })
    expect(f.saved().hashes).toEqual({})
  })
  it('does not mark unpresented tasks as already reported', async () => {
    const f = fixture(), topic = f.evidence.contacts[0].topics[0]
    f.evidence.contacts[0].topics = Array.from({ length: 10 }, (_, i) => ({ ...topic, id: `t${i}` }))
    await f.service.send('greeting', 'a')
    expect(Object.keys(f.saved().hashes)).toHaveLength(8)
    await f.service.send('return', 'b')
    expect(f.deps.summarize.mock.calls[1][0]).toHaveLength(2)
    expect(Object.keys(f.saved().hashes)).toHaveLength(10)
  })
  it('reports partial inspection honestly and retries the unavailable contact later', async () => {
    const f = fixture()
    f.deps.inspect.mockResolvedValueOnce({ ...f.evidence, contacts: [...f.evidence.contacts, { id: 'offline', name: '老周', unavailable: true, error: 'unavailable' }] })
    await f.service.send('greeting', 'a')
    expect(f.deps.deliver.mock.calls[0][0]).toMatchObject({ content: expect.stringContaining('老周的状态读取失败') })
    expect(Object.keys(f.saved().hashes)).toHaveLength(1)
  })
  it('does not deliver stale task content when a task is deleted during generation', async () => {
    const f = fixture()
    f.deps.summarize.mockImplementation(async () => { f.evidence.contacts[0].topics = []; return 'old' })
    await f.service.send('greeting', 'a')
    expect(f.deps.deliver.mock.calls[0][0]).toMatchObject({ content: expect.not.stringContaining('#contact-task') })
    expect(f.saved().hashes).toEqual({})
  })
  it('discards stale pending content after restart if its task was deleted', async () => {
    const f = fixture()
    f.deps.deliver.mockImplementationOnce(() => { throw new Error('disk') })
    await expect(f.service.send('greeting', 'a')).rejects.toThrow()
    f.evidence.contacts[0].topics = []
    await new CompanionBriefing(f.deps).send('greeting', 'a')
    expect(f.deps.deliver.mock.calls[1][0]).toMatchObject({ content: expect.stringContaining('目前没有联系人任务') })
    expect(f.deps.summarize).toHaveBeenCalledTimes(1)
  })
  it('does not send generated data if inspection permission is revoked', async () => {
    const f = fixture()
    f.deps.summarize.mockImplementation(async () => { f.deps.allowed.mockReturnValue(false); return 'private' })
    await f.service.send('return', 'a')
    expect(f.deps.deliver).not.toHaveBeenCalled()
  })
  it('does not confuse failed reads with no work or advance a successful check time', async () => {
    const f = fixture()
    f.deps.inspect.mockResolvedValue({ ...f.evidence, contacts: [{ id: 'writer', name: '阿笔', unavailable: true, error: 'offline' }] })
    await f.service.send('greeting', 'a')
    expect(f.deps.deliver.mock.calls[0][0].content).toContain('全部读取失败')
    expect(f.saved().checkedAt).toBeUndefined()
    expect(f.deps.summarize).not.toHaveBeenCalled()
  })
  it('preserves corrupt checkpoint data and reports the failure without calling the model', async () => {
    const f = fixture()
    f.deps.write('{broken')
    await f.service.send('greeting', 'a')
    expect(f.deps.read()).toBe('{broken')
    expect(f.deps.deliver.mock.calls[0][0].content).toContain('记录无法读取')
    expect(f.deps.summarize).not.toHaveBeenCalled()
  })
  it('finishes a checkpoint commit after delivery without regenerating a cleared message', async () => {
    const f = fixture(), write = f.deps.write.getMockImplementation()!
    f.deps.write.mockImplementationOnce(write).mockImplementationOnce(() => { throw new Error('disk') })
    await expect(f.service.send('greeting', 'a')).rejects.toThrow('disk')
    expect(f.receipts.has('a')).toBe(true)
    await new CompanionBriefing(f.deps).send('greeting', 'a')
    expect(f.deps.summarize).toHaveBeenCalledTimes(1)
    expect(f.saved().pending).toBeUndefined()
  })
})
