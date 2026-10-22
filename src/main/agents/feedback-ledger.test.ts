import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContactTaskStore } from '../task-center/contact-store'

const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).reverse().forEach(fn => fn()))
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-feedback-ledger-')), file = join(dir, 'agents.db')
  let store = new ContactTaskStore(file)
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }), () => store.close())
  store.ensure('alice'); store.ensure('bob')
  const topic = store.topics.create('alice', { title: 'Book', goal: 'Write', constraints: '' })
  const finish = (runId: string, body: string) => store.finish(runId,
    { runId, title: 'Chapter', body: 'Saved', nextStep: 'Continue', evidence: [], createdAt: Date.now() }, [],
    { status: 'researching', judgement: 'Saved', nextStep: 'Continue', reason: 'Saved', openQuestions: '' },
    { completionCriteria: 'Finish', stages: [{ id: 'write', title: 'Write', status: 'active' }], summary: 'Saved', section: { id: 'one', title: 'Chapter', body } })
  finish(store.createRun('alice', '', Date.now(), topic.id), 'Original prose')
  const input = { topicId: topic.id, revision: store.topics.get('alice', topic.id).revision, version: 1, action: 'revise' as const, reason: 'Improve the ending', requestId: 'action:stable-feedback', conversation: '' }
  return { get store() { return store }, topic, input, finish, reopen() { store.close(); store = new ContactTaskStore(file) } }
}
it('uses a durable request identity and refuses changed payloads and foreign or stale versions', () => {
  const f = fixture(), before = f.store.overview('alice').runs.length
  expect(() => f.store.feedbackLedger.submit('bob', f.input)).toThrow()
  expect(() => f.store.feedbackLedger.submit('alice', { ...f.input, version: 2 })).toThrow('版本')
  const receipt = f.store.feedbackLedger.submit('alice', f.input)
  f.reopen()
  expect(f.store.feedbackLedger.submit('alice', f.input)).toEqual(receipt)
  expect(f.store.overview('alice').runs).toHaveLength(before + 1)
  expect(() => f.store.feedbackLedger.submit('alice', { ...f.input, reason: 'Different request' })).toThrow('请求标识')
  expect(f.store.feedbackLedger.list('alice', f.topic.id)[0]).toMatchObject({ requestId: f.input.requestId, baseVersion: 1, runId: receipt.runId, status: 'queued' })
})
it.each(['running', 'waiting', 'failed', 'cancelled', 'interrupted'] as const)('projects actual %s status without inventing a result', status => {
  const f = fixture(), receipt = f.store.feedbackLedger.submit('alice', f.input)
  f.store.setStatus(receipt.runId!, status)
  f.reopen()
  const row = f.store.feedbackLedger.list('alice', f.topic.id)[0]
  expect(row.status).toBe(status); expect(row.resultVersion).toBeUndefined()
  expect(f.store.deliveries.get(f.topic.id)?.version).toBe(1)
})
it('binds the actual result only inside the finishing transaction and retries without duplicate feedback', () => {
  const f = fixture(), receipt = f.store.feedbackLedger.submit('alice', f.input)
  f.store.db.exec("CREATE TRIGGER feedback_result_failure BEFORE UPDATE OF result_version ON contact_delivery_feedback BEGIN SELECT RAISE(ABORT,'feedback result failure'); END")
  expect(() => f.finish(receipt.runId!, 'Revised prose')).toThrow('feedback result failure')
  expect(f.store.deliveries.get(f.topic.id)?.version).toBe(1)
  expect(f.store.feedbackLedger.list('alice', f.topic.id)[0].resultVersion).toBeUndefined()
  expect(f.store.getRun(receipt.runId!)?.status).toBe('queued')
  f.store.db.exec('DROP TRIGGER feedback_result_failure')
  f.finish(receipt.runId!, 'Revised prose'); f.finish(receipt.runId!, 'Revised prose')
  f.reopen()
  expect(f.store.feedbackLedger.list('alice', f.topic.id)).toMatchObject([{ baseVersion: 1, resultVersion: 2, runId: receipt.runId, status: 'completed' }])
  expect(f.store.feedbackLedger.submit('alice', f.input)).toEqual(receipt)
  expect(f.store.deliveries.get(f.topic.id, 1)?.sections[0].body).toBe('Original prose')
  expect(f.store.deliveries.get(f.topic.id, 2)?.sections[0].body).toBe('Revised prose')
})
it('rolls back the queued revision if saving its feedback fails', () => {
  const f = fixture(), before = f.store.overview('alice').runs
  f.store.db.exec("CREATE TRIGGER feedback_insert_failure BEFORE INSERT ON contact_delivery_feedback BEGIN SELECT RAISE(ABORT,'feedback write failure'); END")
  expect(() => f.store.feedbackLedger.submit('alice', f.input)).toThrow('feedback write failure')
  expect(f.store.overview('alice').runs).toEqual(before)
  f.store.db.exec('DROP TRIGGER feedback_insert_failure')
  f.store.feedbackLedger.submit('alice', f.input)
  expect(f.store.overview('alice').runs).toHaveLength(before.length + 1)
})
it('records acceptance without changing work and labels old unlinked feedback honestly', () => {
  const f = fixture(), before = f.store.topics.get('alice', f.topic.id), runs = f.store.overview('alice').runs
  f.store.feedbackLedger.submit('alice', { ...f.input, action: 'accept' })
  expect(f.store.topics.get('alice', f.topic.id)).toEqual(before)
  expect(f.store.overview('alice').runs).toEqual(runs)
  f.store.db.prepare('INSERT INTO contact_delivery_feedback(character_id,topic_id,version,action,reason,at) VALUES(?,?,?,?,?,?)').run('alice', f.topic.id, 1, 'revise', 'Old opinion', 1)
  f.reopen()
  const rows = f.store.feedbackLedger.list('alice', f.topic.id)
  expect(rows.find(r => r.requestId)?.status).toBe('accepted')
  expect(rows.find(r => !r.requestId)).toMatchObject({ status: 'unlinked', reason: 'Old opinion' })
  expect(rows.find(r => !r.requestId)?.runId).toBeUndefined()
  expect(() => f.store.feedbackLedger.list('bob', f.topic.id)).toThrow()
})
it('keeps the selected section and presentation-only scope from the existing revision dialog', () => {
  const f = fixture()
  const first = f.store.feedbackLedger.submit('alice', { ...f.input, citation: { ref: { characterId: 'alice', topicId: f.topic.id, version: 1, sectionId: 'one' } } })
  expect(JSON.parse(f.store.getRun(first.runId!)!.input).revisionCitation.ref.sectionId).toBe('one')
  f.finish(first.runId!, 'Revised prose')
  const second = f.store.feedbackLedger.submit('alice', { ...f.input, requestId: 'style:two', scope: 'presentation', version: 2, revision: f.store.topics.get('alice', f.topic.id).revision })
  expect(JSON.parse(f.store.getRun(second.runId!)!.input).revisionScope).toBe('presentation')
})
