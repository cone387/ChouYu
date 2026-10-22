import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContactTaskStore } from '../task-center/contact-store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { saveDeliveryFeedback, createDeliveryFeedbackTools } from './delivery-feedback'
import type { ToolExecutionContext } from '../tools/registry'
const cleanup: (() => void)[] = []
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close() })
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'delivery-feedback-')), store = new ContactTaskStore(join(dir, 'agents.db'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }), () => store.close())
  store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: '写作' }, Date.now(), false); store.ensure('bob')
  const topic = store.topics.create('alice', { title: '写作', goal: '写一篇文章', constraints: '' }), run = store.createRun('alice', '', Date.now(), topic.id)
  const report = { runId: run, title: '正文', body: '实际正文', nextStep: '继续', evidence: [], createdAt: Date.now() }
  const progress = { judgement: '已保存', openQuestions: '', nextStep: '继续', reason: '依据正文', status: 'researching' as const }
  store.deliveries.commit(topic.id, report, progress)
  return { store, topic, report, progress }
}
it('records acceptance of an exact version without ending or resuming the task', () => {
  const f = fixture(), before = f.store.topics.get('alice', f.topic.id), runs = f.store.overview('alice').runs
  const result = saveDeliveryFeedback(f.store, 'alice', f.topic.id, before.revision, 1, 'accept', '认可这版', '')
  expect(result).toMatchObject({ saved: true, version: 1, action: 'accept', workCompleted: false })
  expect(f.store.topics.get('alice', f.topic.id)).toEqual(before)
  expect(f.store.overview('alice').runs).toEqual(runs)
  expect(f.store.db.prepare('SELECT COUNT(*) AS n FROM contact_delivery_feedback').get()).toEqual({ n: 1 })
})
it('rejects foreign, stale or missing-version feedback before recording it', () => {
  const f = fixture(), revision = f.store.topics.get('alice', f.topic.id).revision
  expect(() => saveDeliveryFeedback(f.store, 'bob', f.topic.id, revision, 1, 'accept', '认可', '')).toThrow()
  expect(() => saveDeliveryFeedback(f.store, 'alice', f.topic.id, revision, 2, 'accept', '认可', '')).toThrow('版本')
  f.store.db.prepare("UPDATE runs SET status='completed' WHERE id=?").run(f.report.runId)
  const next = f.store.createRun('alice', '', Date.now(), f.topic.id)
  f.store.deliveries.commit(f.topic.id, { ...f.report, runId: next }, f.progress)
  expect(() => saveDeliveryFeedback(f.store, 'alice', f.topic.id, revision, 1, 'revise', '修改末段', '')).toThrow('版本')
})
it('does not record a revision as accepted when the original task cannot be revised', () => {
  const f = fixture(), revision = f.store.topics.get('alice', f.topic.id).revision
  expect(() => saveDeliveryFeedback(f.store, 'alice', f.topic.id, revision, 1, 'revise', '修改末段', '')).toThrow()
  expect(f.store.db.prepare('SELECT COUNT(*) AS n FROM contact_delivery_feedback').get()).toEqual({ n: 0 })
})
it('carries the same actual tool execution identity across preparation and response retries', async () => {
  const f = fixture(), topic = f.store.topics.get('alice', f.topic.id)
  const tool = createDeliveryFeedbackTools({ owner: () => 'alice', dispatchUnknown: async (method, owner, args = []) => {
    if (method === 'get') return f.store.overview(owner)
    if (method === 'delivery') return f.store.deliveries.get(String(args[0]), args[1] as number | undefined)
    if (method === 'deliveryFeedbackList') return f.store.feedbackLedger.list(owner, String(args[0]))
    if (method === 'deliveryFeedback') return saveDeliveryFeedback(f.store, owner, String(args[0]), Number(args[1]), Number(args[2]), String(args[3]), String(args[4]), '', args[5] as string)
    throw new Error('Unexpected command')
  } })[0]
  const args = { topicId: topic.id, revision: topic.revision, deliveryVersion: 1, action: 'accept', reason: '认可这版' }
  const context = { sessionId: 'chat', executionId: 'request:one:tool:two' } as unknown as ToolExecutionContext
  const prepared = await tool.prepareAsync!(args, context), first = await prepared.execute()
  expect(await prepared.execute()).toEqual(first)
  f.store.setStatus(f.report.runId, 'completed')
  const newer = f.store.createRun('alice', '', Date.now(), topic.id)
  f.store.finish(newer, { ...f.report, runId: newer }, [], f.progress)
  expect(await (await tool.prepareAsync!(args, context)).execute()).toEqual(first)
  expect(f.store.feedbackLedger.list('alice', topic.id)).toHaveLength(1)
})
