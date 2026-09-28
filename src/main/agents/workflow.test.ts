import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentService } from './service'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => { for (const close of cleanups.splice(0)) await close() })
const stages = [{ id: 'draft', title: '撰写正文', status: 'pending' }, { id: 'review', title: '检查并完成', status: 'pending' }]
const brief = { title: '写一篇短文', nextStep: '撰写正文', question: '', plan: { completionCriteria: '交付完整短文并检查一致性', stages } }
async function fixture(options: { enabled?: boolean; dailyCalls?: number; repeat?: boolean; renamedRepeat?: boolean; question?: boolean; complete?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-workflow-'))
  let drafts = 0
  const model = vi.fn(async (prompt: string) => {
    if (prompt.startsWith('你是联系人，刚收到')) return JSON.stringify({ ...brief, question: options.question ? '主角是谁？' : '' })
    if (prompt.startsWith('为联系人')) return JSON.stringify({ action: 'write', reason: '继续创作正文', query: '', urls: [], checkAfterMinutes: 180 })
    drafts++
    const done = options.complete && drafts === 2
    return JSON.stringify({ title: '本轮正文', body: '保存正文', nextStep: done ? '' : '继续下一部分', memories: [], question: '',
      progress: { judgement: '已保存本轮正文', reason: '实际交付', openQuestions: '', nextStep: done ? '' : '继续下一部分', status: done ? 'completed' : 'researching' },
      delivery: { ...brief.plan, summary: '已保存正文', stages: stages.map(s => ({ ...s, status: done ? 'done' : 'active' })), section: { id: options.repeat && !options.renamedRepeat ? 'same' : `part${drafts}`, title: '正文', body: options.repeat ? '相同正文' : `正文第 ${drafts} 部分` } } })
  })
  const service = new AgentService(dir, () => {}, () => model)
  cleanups.push(async () => { await service.close(); rmSync(dir, { recursive: true, force: true }) })
  await service.sync([{ id: 'bi', soul: '', conversation: '', config: { provider: 'openai', baseUrl: 'https://example.com', apiKey: 'test', model: 'test', thinkingDisabledModels: [] } }])
  await service.request('savePreferences', 'bi', [{ ...DEFAULT_AGENT_SETTINGS, goal: '按用户要求创作', enabled: options.enabled ?? true, dailyCalls: options.dailyCalls ?? 8 }])
  await service.request('assignTopic', 'bi', ['写一篇短文'])
  return { service, model, data: () => service.store.overview('bi') }
}
it('persists the initial plan before a clarification and produces no premature artifact', async () => {
  const f = await fixture({ question: true })
  await vi.waitFor(() => expect(f.data().runs[0].status).toBe('waiting'))
  const topic = f.data().topics[0]
  expect(topic.initialPlan).toEqual(brief.plan)
  expect(f.service.store.deliveries.get(topic.id)).toBeNull()
  expect(f.service.store.deliveries.context(topic.id)?.directory).toEqual([])
  expect(f.model).toHaveBeenCalledTimes(1)
  expect(f.service.store.notices.pending('bi').some(n => n.kind === 'question')).toBe(true)
})
it('continues writing automatically and stops after all planned stages are complete', async () => {
  const f = await fixture({ complete: true })
  await vi.waitFor(() => expect(f.data().topics[0].status).toBe('completed'))
  expect(f.data().runs).toHaveLength(2)
  expect(f.model).toHaveBeenCalledTimes(5)
  expect(f.service.store.deliveries.get(f.data().topics[0].id)?.sections).toHaveLength(2)
  f.service.tick()
  expect(f.data().runs).toHaveLength(2)
})
it('stops automatic writing at the model budget and preserves already delivered work', async () => {
  const f = await fixture({ dailyCalls: 5 })
  await vi.waitFor(() => expect(f.data().reports).toHaveLength(2))
  expect(f.data().callsToday).toBe(5)
  f.service.tick()
  expect(f.data().runs).toHaveLength(2)
  expect(f.data().topics[0].status).toBe('researching')
})
it('does not continue when continuous work is disabled', async () => {
  const f = await fixture({ enabled: false })
  await vi.waitFor(() => expect(f.data().reports).toHaveLength(1))
  f.service.tick()
  expect(f.data().runs).toHaveLength(1)
})
it.each([false, true])('backs off on repeated text even when the section is renamed: %s', async renamedRepeat => {
  const f = await fixture({ repeat: true, renamedRepeat })
  await vi.waitFor(() => expect(f.data().reports).toHaveLength(2))
  expect(f.data().nextAt).toBeGreaterThan(Date.now() + 179 * 60000)
  f.service.tick()
  expect(f.data().runs).toHaveLength(2)
})
it('rejects completion without a deliverable or with a missing planned stage atomically', async () => {
  const f = await fixture({ question: true })
  await vi.waitFor(() => expect(f.data().runs[0].status).toBe('waiting'))
  const before = f.data(), runId = before.runs[0].id
  const report = { runId, title: '声称完成', body: '任务已完成', nextStep: '', evidence: [], createdAt: Date.now() }
  const progress = { judgement: '已完成', openQuestions: '', nextStep: '', reason: '声称完成', status: 'completed' as const }
  expect(() => f.service.store.finish(runId, report, [], progress)).toThrow('实际成果')
  expect(() => f.service.store.finish(runId, report, [], progress, {
    ...brief.plan, stages: [{ id: 'draft', title: '撰写正文', status: 'done' }], summary: '已写正文', section: { id: 'text', title: '正文', body: '实际正文' }
  })).toThrow('阶段未交付或被遗漏')
  expect(f.data().topics).toEqual(before.topics)
  expect(f.data().reports).toHaveLength(0)
  expect(f.service.store.deliveries.get(before.topics[0].id)).toBeNull()
})
