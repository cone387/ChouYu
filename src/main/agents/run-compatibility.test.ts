import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentService } from './service'
import { AgentStore } from './store'
import { parseResearchPlan } from './research'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
function directory() {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-run-compatibility-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
const task = { title: '写一本音乐修炼题材的玄幻小说', goal: '读起来爽 合理', constraints: '' }
const writePlan = { action: 'write', reason: '根据任务直接创作小说', query: '', urls: [], checkAfterMinutes: 180 }

describe('legacy contact tasks without a work direction', () => {
  it('runs the existing novel task and the next round without requiring settings or fetching webpages', async () => {
    let rounds = 0
    const reader = vi.fn(), searcher = vi.fn()
    const model = vi.fn(async (prompt: string) => {
      expect(prompt).toContain(task.title)
      expect(prompt).toContain(task.goal)
      if (prompt.startsWith('为联系人')) return JSON.stringify(writePlan)
      rounds++
      if (rounds === 2) expect(prompt).toContain('第一声琴音')
      return JSON.stringify({ title: `第 ${rounds} 轮创作`, body: rounds === 1 ? '第一声琴音在山谷间响起。' : '少年循着余音踏入山门。', nextStep: '接着写主角的修炼经历', memories: [], question: '', progress: { judgement: `已写出第 ${rounds} 段正文`, openQuestions: '', nextStep: '接着写主角的修炼经历', reason: '按原任务推进正文', status: 'researching' } })
    })
    const service = new AgentService(directory(), () => {}, () => model, reader, searcher)
    cleanups.push(() => service.close())
    await service.sync([{ id: 'bi', soul: '小说作者', conversation: '', config: { provider: 'openai', baseUrl: 'https://example.com', apiKey: 'test', model: 'test', thinkingDisabledModels: [] } }])
    await service.request('createTopic', 'bi', [task])
    expect(service.store.overview('bi').settings.goal).toBe('')
    await service.request('run', 'bi')
    await vi.waitFor(() => expect(service.store.overview('bi').reports).toHaveLength(1))
    const first = service.store.overview('bi')
    expect(first.reports[0].evidence).toEqual([])
    expect(first.callsToday).toBe(2)
    service.store.notices.ack('bi', service.store.notices.pending('bi')[0].id)
    await service.request('run', 'bi', [first.topics[0].id])
    await vi.waitFor(() => expect(service.store.overview('bi').reports).toHaveLength(2))
    const second = service.store.overview('bi')
    expect(second.runs[0].status).toBe('completed')
    expect(second.settings.goal).toBe('')
    expect(second.settings.enabled).toBe(false)
    expect(second.topics[0].goal).toBe(task.goal)
    expect(second.callsToday).toBe(4)
    expect(service.store.detail('bi', second.runs[0].id).research?.plan.action).toBe('write')
    expect(service.store.notices.pending('bi', Date.now() + 1800001)[0].runId).toBe(second.runs[0].id)
    expect(reader).not.toHaveBeenCalled(); expect(searcher).not.toHaveBeenCalled()
  })
  it('still enforces access restrictions and budgets when deriving the goal from the task', () => {
    const store = new AgentStore(join(directory(), 'agents.db')); cleanups.push(() => store.close())
    store.createTopic('bi', task)
    store.db.prepare('UPDATE profiles SET settings=? WHERE character_id=?').run(JSON.stringify({ ...DEFAULT_AGENT_SETTINGS, permissionLevel: 'sources' }), 'bi')
    expect(() => store.createRun('bi', '')).toThrow('限制访问')
    store.db.prepare('UPDATE profiles SET settings=? WHERE character_id=?').run(JSON.stringify({ ...DEFAULT_AGENT_SETTINGS, dailyCalls: 1 }), 'bi')
    expect(() => store.createRun('bi', '')).toThrow('调用上限')
    expect(store.overview('bi').runs).toEqual([])
  })
  it('does not attach invented web activity to a writing plan', () => {
    expect(parseResearchPlan(JSON.stringify(writePlan), [], 180, 'public', false).action).toBe('write')
    expect(() => parseResearchPlan(JSON.stringify({ ...writePlan, urls: ['https://example.com/'] }), [], 180, 'public', false)).toThrow('不能声称')
    expect(() => parseResearchPlan(JSON.stringify({ ...writePlan, query: 'search' }), [], 180, 'public', false)).toThrow('不能声称')
  })
})
