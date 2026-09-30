import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentStore } from './store'
import { AgentRuntime } from './runtime'
import { AgentService } from './service'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { evidenceFromText } from './sources'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
function directory() {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-assignment-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
const settings = { ...DEFAULT_AGENT_SETTINGS, goal: '研究方向', sources: ['https://example.com/'] }
const brief = { title: '下班后的独立项目', nextStep: '先核对可投入时间，再研究合适的方向', question: '每周可以投入多少时间？', plan: { completionCriteria: '提出有证据的项目方向和验证方案', stages: [{ id: 'research', title: '核对需求', status: 'pending' }] } }
const draft = { title: '初步研究', body: '资料 [1] 仅提供线索，需求仍需验证。', nextStep: '继续核对需求', memories: [], question: '', progress: { judgement: '需求尚待验证', openQuestions: '真实需求', nextStep: '继续核对需求', reason: '依据资料 [1]', status: 'needs_evidence' } }
const reader = () => evidenceFromText(settings.sources[0], '公开网页提供了线索，仍需验证。'.repeat(20))

describe('description-only task assignment', () => {
  it('organizes known inputs and persists a missing required input as a question across restart', async () => {
    const dir = directory()
    let store = new AgentStore(join(dir, 'agents.db')), runtime = new AgentRuntime(store, join(dir, 'checkpoints.db'))
    cleanups.push(() => { runtime.close(); store.close() })
    const topic = store.assignTopic('writer', '写一篇奇幻短篇', '用户之前说喜欢宋体排版')
    const run = store.overview('writer').runs[0].id
    const inputs = [{ id: 'genre', label: '题材', value: '奇幻', required: true }, { id: 'reader', label: '读者', value: '', required: true, options: ['成人', '儿童'] }]
    await runtime.execute(run, '作家', async prompt => {
      expect(prompt).toContain('plan.inputs'); expect(prompt).toContain('喜欢宋体排版')
      return JSON.stringify({ ...brief, question: '', plan: { ...brief.plan, inputs } })
    }, new AbortController().signal)
    expect(store.detail('writer', run).run.question).toContain('请补充：读者')
    expect(store.detail('writer', run).run.inputFields).toEqual(inputs)
    runtime.close(); store.close()
    store = new AgentStore(join(dir, 'agents.db')); runtime = new AgentRuntime(store, join(dir, 'checkpoints.db'))
    expect(store.topics.get('writer', topic.id).initialPlan?.inputs).toEqual(inputs)
    expect(store.overview('writer').runs[0].inputFields).toEqual(inputs)
    expect(store.notices.pending('writer')[0].kind).toBe('question')
    expect(() => store.answer('writer', run, '读者：成人', { genre: '奇幻', unknown: '成人' })).toThrow('未知')
    expect(() => store.answer('writer', run, '读者：成人', { genre: '奇幻', reader: '' })).toThrow('有效')
    store.answer('writer', run, '题材：奇幻\n读者：成人', { genre: '奇幻', reader: '成人' })
    await runtime.execute(run, '作家', async prompt => {
      if (prompt.startsWith('为联系人')) return JSON.stringify({ action: 'write', reason: '开始写作', query: '', urls: [], checkAfterMinutes: 180 })
      expect(prompt).toContain('读者：成人')
      return JSON.stringify({ ...draft, delivery: { ...brief.plan, inputs, summary: '开始写作', section: { id: 'opening', title: '开篇', body: '雨落在长廊上。' } } })
    }, new AbortController().signal)
    expect(store.detail('writer', run).run.status).toBe('completed')
    // User form values take precedence even if the model echoes stale input values.
    expect(store.deliveries.get(topic.id)?.inputs?.find(field => field.id === 'reader')?.value).toBe('成人')
  })
  it('creates the default profile, focused topic and first run atomically from one description', () => {
    const store = new AgentStore(join(directory(), 'agents.db')); cleanups.push(() => store.close())
    const topic = store.assignTopic('alice', '帮我研究下班后能做的项目', '')
    const data = store.overview('alice')
    expect(data.topics).toHaveLength(1)
    expect(data.settings.enabled).toBe(true)
    expect(data.settings.sources).toEqual([])
    expect(data.settings.goal).not.toBe(topic.goal)
    expect(data.focusTopicId).toBe(topic.id)
    expect(data.runs[0].status).toBe('queued')
    const second = store.assignTopic('alice', '再交一个任务', '')
    expect(store.overview('alice').topics).toHaveLength(2)
    expect(store.overview('alice').queuedTopicIds).toEqual([second.id])
    expect(store.overview('alice').focusTopicId).toBe(topic.id)
    expect(store.overview('alice').runs).toHaveLength(1)
  })
  it('keeps a new assignment queued without spending when the first round cannot be afforded', () => {
    const store = new AgentStore(join(directory(), 'agents.db')); cleanups.push(() => store.close())
    store.save('alice', { ...settings, sources: [], dailyCalls: 2 })
    const before = store.overview('alice')
    const topic = store.assignTopic('alice', '新的研究', '')
    expect(store.overview('alice').queuedTopicIds).toEqual([topic.id])
    expect(store.overview('alice').runs).toEqual(before.runs)
    expect(store.callCount('alice')).toBe(0)
  })
  it('persists clarification across restart, carries replies into research, and delivers a later question separately', async () => {
    const dir = directory()
    let store = new AgentStore(join(dir, 'agents.db'))
    const read = vi.fn(async () => reader())
    let runtime = new AgentRuntime(store, join(dir, 'checkpoints.db'), read)
    cleanups.push(() => { runtime.close(); store.close() })
    store.save('alice', settings)
    // Upgrade a populated v4 store, whose old index allowed only one change per run.
    store.db.exec('DROP INDEX changes_run; CREATE UNIQUE INDEX changes_run ON topic_changes(run_id) WHERE run_id IS NOT NULL; PRAGMA user_version=4;')
    runtime.close(); store.close()
    store = new AgentStore(join(dir, 'agents.db')); runtime = new AgentRuntime(store, join(dir, 'checkpoints.db'), read)
    expect(store.overview('alice').topics).toHaveLength(1)
    const description = '帮我研究下班后能做的项目'
    const topic = store.assignTopic('alice', description, '')
    const runId = store.overview('alice').runs[0].id
    const model = vi.fn(async (prompt: string) => {
      if (prompt.startsWith('你是联系人，刚收到')) return JSON.stringify(brief)
      if (prompt.startsWith('根据用户对待确认问题')) return JSON.stringify({ ...draft, body: '根据用户同意访谈的回复，下一步安排访谈问题；尚未联系任何人。' })
      expect(prompt).toContain('每周五小时')
      return JSON.stringify({ ...draft, question: '是否愿意访谈潜在用户？' })
    })
    await runtime.execute(runId, '', model, new AbortController().signal)
    expect(read).not.toHaveBeenCalled()
    const firstQuestion = store.notices.pending('alice')[0]
    expect(store.topics.get('alice', topic.id).initialPlan).toEqual(brief.plan)
    expect(store.deliveries.get(topic.id)).toBeNull()
    expect(firstQuestion.content).toContain(brief.question)
    store.notices.ack('alice', firstQuestion.id)
    runtime.close(); store.close()
    store = new AgentStore(join(dir, 'agents.db')); runtime = new AgentRuntime(store, join(dir, 'checkpoints.db'), read)
    expect(store.topics.get('alice', topic.id).initialPlan).toEqual(brief.plan)
    store.answer('alice', runId, '每周五小时')
    await runtime.execute(runId, '', model, new AbortController().signal)
    expect(model).toHaveBeenCalledTimes(2)
    expect(store.topics.get('alice', topic.id).goal).toBe(description)
    expect(store.topics.get('alice', topic.id).constraints).toBe('每周五小时')
    expect(store.topics.get('alice', topic.id).title).toBe(brief.title)
    const secondQuestion = store.notices.pending('alice')[0]
    expect(secondQuestion.id).not.toBe(firstQuestion.id)
    expect(secondQuestion.content).toContain('是否愿意访谈')
    store.answer('alice', runId, '可以访谈')
    await runtime.execute(runId, '', model, new AbortController().signal)
    expect(model).toHaveBeenCalledTimes(3)
    expect(read).toHaveBeenCalledTimes(1)
    expect(store.detail('alice', runId).run.status, JSON.stringify(store.detail('alice', runId))).toBe('completed')
    expect(store.topics.get('alice', topic.id).constraints).toBe('每周五小时')
  })
  it('starts automatically for a clear request and rejects missing model configuration before creation', async () => {
    const model = vi.fn(async (prompt: string) => JSON.stringify(prompt.startsWith('你是联系人，刚收到') ? { ...brief, question: '' } : draft))
    const service = new AgentService(directory(), () => {}, () => model, async () => reader())
    cleanups.push(() => service.close())
    const config = { provider: 'openai' as const, baseUrl: 'https://example.com', apiKey: 'test', model: 'test', thinkingDisabledModels: [] }
    await service.sync([{ id: 'alice', soul: '', conversation: '', config }, { id: 'bob', soul: '', conversation: '', config: null }])
    await expect(service.request('assignTopic', 'bob', ['研究需求'])).rejects.toThrow('模型')
    expect(service.store.overview('bob').topics).toEqual([])
    await service.request('savePreferences', 'alice', [settings])
    expect(service.store.overview('alice').topics).toEqual([])
    const before = service.store.overview('alice')
    await expect(service.request('feedback', 'alice', [before.revision - 1, 'assignTopic', ['研究需求']])).rejects.toThrow('变化')
    expect(service.store.overview('alice').topics).toEqual([])
    await service.request('save', 'alice', [settings])
    await service.request('assignTopic', 'alice', ['每周五小时，研究独立开发者需求'])
    await vi.waitFor(() => expect(service.store.overview('alice').reports, JSON.stringify(service.store.overview('alice').runs)).toHaveLength(1))
    expect(model).toHaveBeenCalledTimes(2)
    expect(service.store.overview('alice').runs[0].status).toBe('completed')
    const direction = service.store.notices.pending('alice')[0]
    expect(direction.purpose).toBe('direction')
    expect(direction.content).toContain(brief.nextStep)
    service.store.notices.ack('alice', direction.id)
    expect(service.store.notices.pending('alice')[0].id).toContain(':progress')
  })
})
