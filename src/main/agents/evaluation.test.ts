import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentStore } from './store'
import { AgentRuntime, parseDraft } from './runtime'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { deliveryMarkdown } from '../../shared/agent-delivery'

const evaluations = [{ subject: 'idea', sourceNumbers: [], dimensions: [{ name: '可行性', score: 4, maxScore: 5, weight: 100, reason: '尚需验证' }], summary: '建议验证', risks: '缺乏数据', nextStep: '访谈', claimedTotal: 60 }]
const progress = { status: 'researching', judgement: '已评价', openQuestions: '', nextStep: '继续', reason: '评价' }
const draft = { title: '评价', body: '错误旧总分：60', nextStep: '继续', memories: [], question: '', progress, evaluations,
  delivery: { summary: '已评价', completionCriteria: '持续评价', stages: [{ id: 'review', title: '评价', status: 'active' }], section: { id: 'review1', title: '评价1', body: '总分60' } } }
const cleanup: (() => void)[] = []
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close() })
it('requires structured scores when the plan requests evaluation', () => {
  expect(() => parseDraft(JSON.stringify({ ...draft, evaluations: undefined }), 0, true)).toThrow('结构化')
  const parsed = parseDraft(JSON.stringify(draft), 0, true)
  expect(parsed.body).toBe('idea：80/100（系统计算）')
  expect(parsed.delivery?.section.body).toContain('系统计算总分：80/100')
  expect(parsed.evaluations?.[0].claimedTotal).toBe(60)
})
it('persists computed totals in reports, versioned deliverables and Markdown export', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-evaluation-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const store = new AgentStore(join(dir, 'agents.db')), runtime = new AgentRuntime(store, join(dir, 'checkpoints.db'))
  cleanup.push(() => { runtime.close(); store.close() })
  store.save('reviewer', { ...DEFAULT_AGENT_SETTINGS, goal: '评价 idea', dailyCalls: 20 })
  const run = store.createRun('reviewer', '')
  await runtime.execute(run, '', async prompt => prompt.startsWith('为联系人')
    ? JSON.stringify({ action: 'write', reason: '评价假设', query: '', urls: [], checkAfterMinutes: 180, evaluation: true })
    : JSON.stringify(draft), new AbortController().signal)
  expect(store.detail('reviewer', run).run.status).toBe('completed')
  expect(store.detail('reviewer', run).report?.evaluations?.[0].total).toBe(80)
  const delivery = store.deliveries.get(store.overview('reviewer').focusTopicId!)!
  expect(deliveryMarkdown('评价', delivery)).toContain('系统计算总分：80/100')
  expect(deliveryMarkdown('评价', delivery)).toContain('模型原报 60/100')
})
it('does not publish malformed scores even after one format repair attempt', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-invalid-evaluation-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const store = new AgentStore(join(dir, 'agents.db')), runtime = new AgentRuntime(store, join(dir, 'checkpoints.db'))
  cleanup.push(() => { runtime.close(); store.close() })
  store.save('reviewer', { ...DEFAULT_AGENT_SETTINGS, goal: '评价 idea', dailyCalls: 20 })
  const run = store.createRun('reviewer', '')
  let calls = 0
  await runtime.execute(run, '', async () => {
    calls++
    return calls === 1 ? JSON.stringify({ action: 'write', reason: '评价', query: '', urls: [], checkAfterMinutes: 180, evaluation: true })
      : JSON.stringify({ ...draft, evaluations: [{ ...evaluations[0], dimensions: [{ ...evaluations[0].dimensions[0], weight: 90 }] }] })
  }, new AbortController().signal)
  expect(calls).toBe(3)
  expect(store.detail('reviewer', run).run.status).toBe('failed')
  expect(store.detail('reviewer', run).report).toBeNull()
  expect(store.deliveries.get(store.overview('reviewer').focusTopicId!)).toBeNull()
})
