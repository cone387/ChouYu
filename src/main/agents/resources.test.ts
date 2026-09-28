import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentStore } from './store'
import { AgentService } from './service'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { validateTaskResourceBudget } from '../../shared/agent-resources'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
function directory() {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-resource-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
function fixture() {
  const path = join(directory(), 'agents.db'), store = new AgentStore(path)
  cleanups.push(() => store.close())
  store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: '任务资源分配', dailyCalls: 12 })
  return { store, path, topic: store.overview('alice').topics[0] }
}

describe('task resource allocation within contact resources', () => {
  it('saves contact daily limits above 48 without clamping', () => {
    const { store } = fixture()
    for (const dailyCalls of [49, 1000, 100000]) {
      store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: '资源分配', dailyCalls })
      expect(store.overview('alice').settings.dailyCalls).toBe(dailyCalls)
    }
    for (const dailyCalls of [NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: '资源分配', dailyCalls })).toThrow('有效整数')
    }
  })
  it('validates integer budgets and a visible allocation reason', () => {
    for (const value of [0, -1, 1.5, 10001, Infinity]) expect(() => validateTaskResourceBudget({ modelCalls: value, reason: 'test' })).toThrow()
    expect(() => validateTaskResourceBudget({ modelCalls: 4, reason: '' })).toThrow()
  })
  it('reserves resources for other tasks and prevents manual over-allocation', () => {
    const { store, topic } = fixture()
    store.setTaskBudget('alice', topic.id, topic.revision, { modelCalls: 8 })
    expect(store.topics.get('alice', topic.id).resourceBudget).toEqual({ modelCalls: 8, reason: '用户手动调整任务预算。' })
    const second = store.createTopic('alice', { title: '核对资料', goal: '核对', constraints: '' }).topics.find(t => t.id !== topic.id)!
    expect(store.resourceContext('alice', second.id).allocatableCalls).toBe(4)
    expect(() => store.setTaskBudget('alice', second.id, second.revision, { modelCalls: 5, reason: '超出总资源' })).toThrow('可分配 4')
    store.setTaskBudget('alice', second.id, second.revision, { modelCalls: 4, reason: '两轮核对' })
    const current = store.topics.get('alice', topic.id)
    store.setTaskBudget('alice', topic.id, current.revision, { modelCalls: 6, reason: '释放两次给其他任务' })
    expect(store.resourceContext('alice', second.id).allocatableCalls).toBe(6)
    expect(() => store.setTaskBudget('bob', topic.id, current.revision, { modelCalls: 3, reason: '越权' })).toThrow()
  })
  it('counts failed calls across days and persists the cap across restart', () => {
    const { store, path, topic } = fixture()
    store.setTaskBudget('alice', topic.id, topic.revision, { modelCalls: 2, reason: '一轮预算' })
    const yesterday = Date.now() - 86400000
    const run = store.createRun('alice', '', yesterday, topic.id)
    store.charge(run, yesterday); store.charge(run, yesterday)
    expect(() => store.charge(run)).toThrow('本任务调用预算不足')
    store.setStatus(run, 'failed')
    expect(store.callCount('alice')).toBe(0)
    const reopened = new AgentStore(path); cleanups.push(() => reopened.close())
    expect(reopened.taskCallCount('alice', topic.id)).toBe(2)
    expect(() => reopened.createRun('alice', '', Date.now(), topic.id)).toThrow('本任务调用预算不足')
    const current = reopened.topics.get('alice', topic.id)
    expect(() => reopened.setTaskBudget('alice', topic.id, current.revision, { modelCalls: 1, reason: '清零历史' })).toThrow('已使用')
    reopened.setTaskBudget('alice', topic.id, current.revision, { modelCalls: 4, reason: '追加一轮' })
    expect(reopened.createRun('alice', '', Date.now(), topic.id)).toBeTruthy()
    expect(reopened.taskCallCount('alice', topic.id)).toBe(2)
  })
  it('clamps model allocations and prevents the model from raising an existing budget', () => {
    const { store, topic } = fixture()
    const run = store.createRun('alice', '', Date.now(), topic.id)
    store.charge(run)
    const allocated = store.allocateTaskBudget(run, { modelCalls: 50, reason: '分阶段执行' })
    expect(allocated.resourceBudget?.modelCalls).toBe(12)
    expect(allocated.resourceBudget?.reason).toContain('收紧')
    expect(store.allocateTaskBudget(run, { modelCalls: 100, reason: '自行加量' }).resourceBudget).toEqual(allocated.resourceBudget)
    expect(() => store.setTaskBudget('alice', topic.id, allocated.revision, { modelCalls: 10, reason: '运行中改量' })).toThrow('暂停')
    expect(store.assertLive(run).topic_revision).toBe(allocated.revision)
  })
  it('lets the planner allocate a task budget, stops before exceeding it, and preserves the deliverable', async () => {
    const stages = [{ id: 'draft', title: '初稿', status: 'pending' }]
    const model = vi.fn(async (prompt: string) => {
      expect(prompt).toContain('resource')
      if (prompt.startsWith('你是联系人，刚收到')) return JSON.stringify({ title: '写短文', nextStep: '写出初稿', question: '', plan: { completionCriteria: '初稿与复核', stages }, resourceBudget: { modelCalls: 3, reason: '一次接单规划、一次执行规划、一次初稿；复核需另行追加' } })
      if (prompt.startsWith('为联系人')) return JSON.stringify({ action: 'write', reason: '写出初稿', query: '', urls: [], checkAfterMinutes: 180 })
      return JSON.stringify({ title: '初稿', body: '已保存初稿', nextStep: '复核', memories: [], question: '', progress: { judgement: '初稿完成', openQuestions: '', nextStep: '复核', reason: '实际交付初稿', status: 'researching' }, delivery: { completionCriteria: '初稿与复核', stages: [{ ...stages[0], status: 'active' }], summary: '初稿已保存', section: { id: 'text', title: '初稿', body: '实际正文' } } })
    })
    const service = new AgentService(directory(), () => {}, () => model)
    cleanups.push(() => service.close())
    await service.sync([{ id: 'alice', soul: '', conversation: '', config: { provider: 'openai', baseUrl: 'https://example.com', apiKey: 'test', model: 'test', thinkingDisabledModels: [] } }])
    await service.request('assignTopic', 'alice', ['写一篇短文'])
    await vi.waitFor(() => expect(service.store.overview('alice').topics[0].status).toBe('paused'))
    const data = service.store.overview('alice'), topic = data.topics[0]
    expect(data.callsToday).toBe(3)
    expect(topic.resourceBudget?.modelCalls).toBe(3)
    expect(service.store.deliveries.get(topic.id)?.sections[0].body).toBe('实际正文')
    expect(service.store.notices.pending('alice').some(n => n.content.includes('预算不足'))).toBe(true)
    service.tick()
    expect(model).toHaveBeenCalledTimes(3)
    expect(() => service.store.continueTopic('alice', topic.id, topic.revision, '继续', '')).toThrow('本任务调用预算不足')
    expect(service.store.topics.get('alice', topic.id).status).toBe('paused')
  })
})
