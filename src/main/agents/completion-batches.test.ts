import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { completionParts, reviewCompletionBatches } from './completion-batches'
import { ContactTaskStore } from '../task-center/contact-store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import type { DeliverySection } from '../../shared/agent-delivery'

const cleanup: (() => void)[] = []
afterEach(() => { cleanup.splice(0).reverse().forEach(close => close()) })
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'completion-parts-'))
  const store = new ContactTaskStore(join(dir, 'agents.db'))
  store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: '写完长文', dailyCalls: 1000 })
  const run = store.createRun('alice', ''), topicId = store.getRun(run)!.topic_id!
  cleanup.push(() => { store.close(); rmSync(dir, { recursive: true, force: true }) })
  return { store, run, topicId }
}
const section = (id: string, body = '真实正文'): DeliverySection => ({ id, title: id, body, runId: 'saved' })
const reply = (prompt: string, issues: string[] = []) => {
  const data = JSON.parse(prompt.split('\n核对数据：\n')[1])
  return JSON.stringify({ key: data.key, readComplete: true, summary: '真实依据', issues, opening: '开头', closing: '末尾' })
}
it('reads a large individual section without dropping or splitting a Unicode character', () => {
  const body = '文'.repeat(59999) + '🐱' + '尾'.repeat(60000)
  const parts = completionParts([section('long', body)])
  expect(parts.map(p => p.body).join('')).toBe(body)
  expect(parts.map(p => [p.start, p.end])).toEqual([[0, 59999], [59999, 119999], [119999, 120001]])
  expect(parts.every(p => p.body.length <= 60000)).toBe(true)
})
it('bounds large failure evidence without hiding the number of unresolved findings', async () => {
  const f = fixture(), sections = Array.from({ length: 90 }, (_, n) => section(`part${n}`))
  const issues = Array.from({ length: 12 }, (_, n) => `${n}:` + '缺少事实依据'.repeat(60))
  const evidence = await reviewCompletionBatches(f.store, f.run, f.topicId, sections, { goal: '核对长文' },
    async prompt => reply(prompt, prompt.startsWith('正文分批核对') ? issues.map(i => JSON.parse(prompt.split('\n核对数据：\n')[1]).part.sectionId + ':' + i) : []), new AbortController().signal, () => {})
  expect(evidence.reviewedParts).toBe(90)
  expect(evidence.receipts.length).toBeLessThanOrEqual(8)
  expect(evidence.issueCount).toBe(1080)
  expect(evidence.omittedIssues).toBe(1068)
  expect(evidence.issues).toHaveLength(12)
  expect(JSON.stringify(evidence).length).toBeLessThan(60000)
})
it('cannot cache a batch that returned after cancellation', async () => {
  const f = fixture()
  await expect(reviewCompletionBatches(f.store, f.run, f.topicId, [section('first')], {}, async prompt => {
    f.store.cancel('alice', '用户暂停')
    return reply(prompt)
  }, new AbortController().signal, () => {})).rejects.toThrow()
  expect(f.store.db.prepare('SELECT count(*) AS n FROM completion_reviews').get()).toEqual({ n: 0 })
})
it('rechecks changed requirements across rounds and cascades checkpoints when a task is deleted', async () => {
  const f = fixture(), seen: string[] = []
  const sections = [section('first'), section('second')]
  const review = (requirements: object, run = f.run) => reviewCompletionBatches(f.store, run, f.topicId, sections, requirements,
    async prompt => { seen.push(prompt); return reply(prompt) }, new AbortController().signal, () => {})
  await review({ goal: '旧要求' })
  f.store.setStatus(f.run, 'completed')
  const nextRun = f.store.createRun('alice', '')
  await review({ goal: '旧要求' }, nextRun)
  expect(seen).toHaveLength(2)
  await review({ goal: '新要求' }, nextRun)
  expect(seen).toHaveLength(4)
  expect(f.store.db.prepare('SELECT count(*) AS n FROM completion_reviews').get()).toEqual({ n: 2 })
  f.store.deleteTopic('alice', f.topicId, f.store.topics.get('alice', f.topicId).revision)
  expect(f.store.db.prepare('SELECT count(*) AS n FROM completion_reviews').get()).toEqual({ n: 0 })
})
