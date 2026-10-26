import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContactTaskStore } from '../task-center/contact-store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { RunScheduler } from '../agent-space/scheduler'
import { ContactTaskCommands } from '../task-center/commands'
import { DEFAULT_APP_CONFIG } from '../../shared/config'

const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).reverse().forEach(fn => fn()))
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-recovery-flow-')), path = join(dir, 'agents.db')
  let store = new ContactTaskStore(path)
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }), () => store.close())
  store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: 'Write', enabled: true, dailyCalls: 100 })
  const topic = store.overview('alice').topics[0]
  const finish = (id: string) => store.finish(id, { runId: id, title: 'Chapter', body: 'Saved', nextStep: 'Continue', evidence: [], createdAt: Date.now() }, [],
    { status: 'researching', judgement: 'Saved', nextStep: 'Continue', reason: 'Saved', openQuestions: '' },
    { completionCriteria: 'Finish', summary: 'Saved', stages: [{ id: 'write', title: 'Write', status: 'active' }], section: { id: 'text', title: 'Text', body: 'Actual prose' } })
  finish(store.createRun('alice', '', Date.now(), topic.id))
  const receipt = store.feedbackLedger.submit('alice', { topicId: topic.id, revision: store.topics.get('alice', topic.id).revision, version: 1, requestId: 'recovery-feedback', action: 'revise', reason: 'Preserve this opinion', citation: { ref: { characterId: 'alice', topicId: topic.id, version: 1, sectionId: 'text' } } })
  return { get store() { return store }, topic, receipt, finish, restart() { store.close(); store = new ContactTaskStore(path); store.recover() } }
}
it.each(['content', 'presentation'] as const)('recovers %s feedback through the work-log run command and keeps duplicate clicks idempotent', async scope => {
  const f = fixture()
  f.store.fail(f.receipt.runId!, 'network timeout')
  const receipt = scope === 'content' ? f.receipt : f.store.feedbackLedger.submit('alice', {
    topicId: f.topic.id, revision: f.store.topics.get('alice', f.topic.id).revision, version: 1,
    requestId: 'work-log-style', action: 'revise', reason: 'Change presentation', scope: 'presentation'
  })
  if (scope === 'presentation') f.store.fail(receipt.runId!, 'network timeout')
  const commands = new ContactTaskCommands({ store: f.store,
    identity: id => ({ id, soul: '', conversation: '', config: DEFAULT_APP_CONFIG }), changed() {}, tick() {},
    remove: async () => {}, activeFor: () => [], abort() {}, activeRun: () => undefined, cleanupThread: async () => {} })
  // Exact existing work-log command path, not a direct store continuation.
  await commands.request('run', 'alice', [f.topic.id])
  const next = f.store.overview('alice').runs[0].id
  const input = JSON.parse(f.store.getRun(next)!.input)
  expect(input).toMatchObject({ recoveryFrom: receipt.runId })
  if (scope === 'content') expect(input.revisionCitation.ref).toMatchObject({ version: 1, sectionId: 'text' })
  else expect(input).toMatchObject({ revisionScope: 'presentation', revisionBaseVersion: 1, feedback: 'Change presentation' })
  expect(f.store.feedbackLedger.list('alice', f.topic.id).find(row => row.requestId === receipt.requestId)).toMatchObject({ runId: next, originalRunId: receipt.runId })
  await commands.dispatchUnknown('run', 'alice', [f.topic.id, receipt.runId])
  expect(f.store.overview('alice').runs[0].id).toBe(next)
  if (scope === 'content') {
    f.finish(next)
    await commands.dispatchUnknown('run', 'alice', [f.topic.id, receipt.runId])
    expect(f.store.overview('alice').runs[0].id).toBe(next)
    expect(f.store.feedbackLedger.list('alice', f.topic.id)[0].resultVersion).toBe(2)
  }
})
it('retries a task whose failed attempt is outside the contact overview history window', async () => {
  const f = fixture()
  f.store.fail(f.receipt.runId!, 'network timeout')
  const other = f.store.createTopic('alice', { title: 'Other', goal: 'Other', constraints: '' }).topics.find(topic => topic.title === 'Other')!
  for (let i = 0; i < 31; i++) f.store.fail(f.store.createRun('alice', '', Date.now(), other.id), 'network timeout')
  expect(f.store.overview('alice').runs.some(run => run.id === f.receipt.runId)).toBe(false)
  const commands = new ContactTaskCommands({ store: f.store,
    identity: id => ({ id, soul: '', conversation: '', config: DEFAULT_APP_CONFIG }), changed() {}, tick() {},
    remove: async () => {}, activeFor: () => [], abort() {}, activeRun: () => undefined, cleanupThread: async () => {} })
  await commands.request('run', 'alice', [f.topic.id, f.receipt.runId])
  const next = f.store.feedbackLedger.list('alice', f.topic.id)[0].runId!
  expect(next).not.toBe(f.receipt.runId)
  expect(JSON.parse(f.store.getRun(next)!.input).revisionCitation.ref).toMatchObject({ version: 1, sectionId: 'text' })
})
it('links bounded automatic network retries to the original opinion and exact citation, committing a result only once', () => {
  const f = fixture(), first = f.receipt.runId!
  f.store.fail(first, 'network timeout')
  const due = f.store.taskFailures.get(f.topic.id)!.next_at
  expect(f.store.nextScheduledTopic('alice', due - 1)).toBeUndefined()
  expect(f.store.nextScheduledTopic('alice', due)).toBe(f.topic.id)
  const next = f.store.startScheduledTopic('alice', f.topic.id, '')
  expect(JSON.parse(f.store.getRun(next)!.input)).toMatchObject({ recoveryFrom: first, feedback: 'Preserve this opinion', revisionCitation: { ref: { version: 1, sectionId: 'text' } } })
  expect(f.store.feedbackLedger.list('alice', f.topic.id)[0]).toMatchObject({ runId: next, status: 'queued', originalRunId: first })
  f.finish(next); f.finish(next); f.restart()
  expect(f.store.feedbackLedger.list('alice', f.topic.id)).toMatchObject([{ baseVersion: 1, resultVersion: 2, runId: next, originalRunId: first }])
  expect(f.store.deliveries.get(f.topic.id)?.version).toBe(2)
})
it('makes explicit retry idempotent after a lost response and rejects changed content with the same identity', () => {
  const f = fixture(); f.store.fail(f.receipt.runId!, 'network timeout')
  const revision = f.store.topics.get('alice', f.topic.id).revision
  const next = f.store.continueTopic('alice', f.topic.id, revision, 'Retry original work', '', 'request:retry')
  f.restart()
  expect(f.store.continueTopic('alice', f.topic.id, revision, 'Retry original work', '', 'request:retry')).toBe(next)
  expect(() => f.store.continueTopic('alice', f.topic.id, revision, 'Different intent', '', 'request:retry')).toThrow('请求')
  expect(f.store.overview('alice').runs.filter(run => run.topicId === f.topic.id)).toHaveLength(3)
})
it('keeps source context across permission cancellation and explicit continuation, without clearing user pauses', () => {
  const f = fixture(), settings = f.store.overview('alice').settings
  f.store.save('alice', { ...settings, readContactDeliveries: true })
  expect(f.store.getRun(f.receipt.runId!)?.status).toBe('cancelled')
  const paused = f.store.topics.get('alice', f.topic.id)
  f.store.changeTopic('alice', f.topic.id, paused.revision, { status: 'paused', reason: 'User pause' })
  f.store.save('alice', settings)
  expect(f.store.nextScheduledTopic('alice', Date.now() + 86400000)).toBeUndefined()
  const next = f.store.continueTopic('alice', f.topic.id, f.store.topics.get('alice', f.topic.id).revision, 'User resumes', '')!
  expect(JSON.parse(f.store.getRun(next)!.input).revisionCitation.ref.version).toBe(1)
  f.finish(next)
  expect(f.store.feedbackLedger.list('alice', f.topic.id)[0].resultVersion).toBe(2)
})
it('rechecks restored read permission after repeated failures and preserves feedback lineage through the resumed work', () => {
  const f = fixture()
  let run = f.receipt.runId!
  for (let i = 0; i < 3; i++) {
    f.store.fail(run, '未授权读取联系人的共享成果。')
    if (i < 2) run = f.store.startScheduledTopic('alice', f.topic.id, '')
  }
  const due = Date.now() + 86400000
  expect(f.store.nextScheduledTopic('alice', due)).toBeUndefined()
  f.store.save('alice', { ...f.store.overview('alice').settings, readContactDeliveries: true }, Date.now(), false)
  expect(f.store.nextScheduledTopic('alice', due)).toBe(f.topic.id)
  const next = f.store.startScheduledTopic('alice', f.topic.id, '')
  f.finish(next)
  expect(f.store.feedbackLedger.list('alice', f.topic.id)[0]).toMatchObject({ originalRunId: f.receipt.runId, runId: next, resultVersion: 2 })
})
it('retries presentation feedback through the same feedback record and rolls causal links back with creation failure', () => {
  const f = fixture(); f.store.fail(f.receipt.runId!, 'network timeout')
  const retryRevision = f.store.topics.get('alice', f.topic.id).revision
  f.store.db.exec("CREATE TRIGGER fail_recovery_link BEFORE INSERT ON feedback_attempts BEGIN SELECT RAISE(ABORT,'recovery link failed'); END")
  expect(() => f.store.continueTopic('alice', f.topic.id, retryRevision, 'Retry', '')).toThrow('recovery link failed')
  expect(f.store.topics.get('alice', f.topic.id).revision).toBe(retryRevision)
  expect(f.store.overview('alice').runs).toHaveLength(2)
  f.store.db.exec('DROP TRIGGER fail_recovery_link')
  const style = f.store.feedbackLedger.submit('alice', { topicId: f.topic.id, revision: retryRevision, version: 1, requestId: 'style-recovery', action: 'revise', reason: 'Change presentation only', scope: 'presentation' })
  f.store.fail(style.runId!, 'network timeout')
  const card = f.store.decisions.pending('alice').find(c => c.runId === style.runId)!
  f.store.decisions.submit('alice', card.id, { version: card.version }, '')
  const record = f.store.feedbackLedger.list('alice', f.topic.id).find(r => r.requestId === 'style-recovery')!
  expect(record).toMatchObject({ originalRunId: style.runId, status: 'queued' })
  expect(record.runId).not.toBe(style.runId)
  expect(JSON.parse(f.store.getRun(record.runId!)!.input)).toMatchObject({ revisionScope: 'presentation', revisionBaseVersion: 1, feedback: 'Change presentation only' })
})
it('preserves the same queued checkpoint and feedback when budget becomes available after restart', () => {
  const f = fixture(), run = f.receipt.runId!
  f.store.setStatus(run, 'running'); f.store.charge(run); f.store.charge(run)
  const settings = f.store.overview('alice').settings
  f.store.save('alice', { ...settings, dailyCalls: 2 }, Date.now(), false)
  f.restart()
  expect(f.store.getRun(run)?.status).toBe('interrupted')
  expect(f.store.reserveRunCalls(run)).toBe(false)
  f.store.save('alice', settings, Date.now(), false)
  expect(f.store.reserveRunCalls(run)).toBe(true)
  f.store.releaseRunCalls(run)
  f.finish(run)
  expect(f.store.feedbackLedger.list('alice', f.topic.id)[0]).toMatchObject({ runId: run, resultVersion: 2 })
})
it('does not attach a new independent revision to an older failed feedback', () => {
  const f = fixture(); f.store.fail(f.receipt.runId!, 'network timeout')
  const fresh = f.store.feedbackLedger.submit('alice', { topicId: f.topic.id, revision: f.store.topics.get('alice', f.topic.id).revision, version: 1, requestId: 'new-feedback', action: 'revise', reason: 'A different opinion' })
  f.finish(fresh.runId!)
  const rows = f.store.feedbackLedger.list('alice', f.topic.id)
  expect(rows.find(row => row.requestId === 'recovery-feedback')?.resultVersion).toBeUndefined()
  expect(rows.find(row => row.requestId === 'new-feedback')?.resultVersion).toBe(2)
})
it('does not replay an uncertain external action after a process restart', () => {
  const f = fixture(), topic = f.store.topics.get('alice', f.topic.id)
  const card = f.store.actions.offer('alice', 'external-operation', { purpose: 'configuration', title: 'Update', body: 'Apply once', sessionId: 's', subject: { kind: 'task', topicId: topic.id, revision: topic.revision }, actions: [{ id: 'apply', label: 'Apply', tool: 'edit_contact_task', arguments: { topicId: topic.id, revision: topic.revision } }] })
  const claim = f.store.actions.claim('alice', card.id, card.version, { actionId: 'apply' })
  f.store.actions.startExecution('alice', card.id, claim.version); f.restart()
  const current = f.store.actions.get('alice', card.id)
  expect(current).toMatchObject({ status: 'failed', retryable: false })
  expect(() => f.store.actions.claim('alice', card.id, current.version, { actionId: 'apply' })).toThrow('核对')
})
it('holds the execution slot until cancelled work actually exits', async () => {
  const scheduler = new RunScheduler(1), key = { id: 'old', characterId: 'alice', topicId: 'task' }
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  expect(scheduler.launch(key, 1, () => held)).toBe(true)
  scheduler.abort('alice', 'task')
  expect(scheduler.launch({ ...key, id: 'retry' }, 1, async () => {})).toBe(false)
  release(); await scheduler.drain()
  expect(scheduler.launch({ ...key, id: 'retry' }, 1, async () => {})).toBe(true)
  await scheduler.drain()
})
