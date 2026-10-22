import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContactTaskStore } from '../task-center/contact-store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { ContactSources } from './contact-sources'

const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).reverse().forEach(fn => fn()))
function fixture(continuous = true, disk = false) {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-dependencies-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const path = disk ? join(dir, 'agents.db') : ':memory:'
  let store = new ContactTaskStore(path)
  cleanup.push(() => store.close())
  for (const id of ['author', 'reader']) store.save(id, { ...DEFAULT_AGENT_SETTINGS, goal: 'Work', enabled: true, paceWriting: false, dailyCalls: 400, shareDeliveries: true, readContactDeliveries: true })
  const topic = store.topics.create('author', { title: 'Draft', goal: 'Write', constraints: '' }, 'user')
  function write(body: string, section = 'text') {
    const runId = store.createRun('author', '', Date.now(), topic.id)
    store.finish(runId, { runId, title: 'Draft', body, nextStep: 'Continue', evidence: [], createdAt: Date.now() }, [],
      { status: 'researching', judgement: 'Saved', nextStep: 'Continue', openQuestions: '', reason: 'Draft' },
      { completionCriteria: 'Write', stages: [{ id: 'draft', title: 'Draft', status: 'active' }], summary: 'Saved', section: { id: section, title: section, body } })
    return runId
  }
  write('Original')
  const handoff = store.handoffs.commit('author', store.handoffs.stage('author', { requestId: 'handoff', source: { characterId: 'author', topicId: topic.id, version: 1, sectionId: 'text' }, recipientId: 'reader', description: 'Review' }, { description: 'Review', requestLog: 'Review', continuous }))
  function review(runId = store.createRun('reader', '', Date.now(), handoff.topicId)) {
    store.handoffs.bindRun(runId)
    store.finish(runId, { runId, title: 'Review', body: 'Actual review', nextStep: '', evidence: store.handoffs.evidence(runId), createdAt: Date.now() }, [],
      { status: 'completed', judgement: 'Reviewed', nextStep: '', openQuestions: '', reason: 'Reviewed' },
      { completionCriteria: 'Review', stages: [{ id: 'review', title: 'Review', status: 'done' }], summary: 'Reviewed', section: { id: 'review', title: 'Review', body: 'Actual review' } })
    return runId
  }
  review()
  // Simulate the existing idle backoff; a durable update can advance only eligible work.
  store.db.prepare('UPDATE task_schedule SET next_at=? WHERE topic_id=?').run(Date.now() + 86400000, handoff.topicId)
  store.db.prepare('UPDATE profiles SET next_at=? WHERE character_id=?').run(Date.now() + 86400000, 'reader')
  return { get store() { return store }, topic, handoff, write, review,
    restart() { store.close(); store = new ContactTaskStore(path) } }
}

it('coalesces actual publications, wakes the idle reviewer once and acknowledges only the consumed fixed version', () => {
  const f = fixture(); f.write('Second'); f.write('Third')
  expect(f.store.dependencies.pending('reader')).toMatchObject([{ topicId: f.handoff.topicId, sourceVersion: 3 }])
  expect(f.store.nextScheduledTopic('reader')).toBe(f.handoff.topicId)
  const run = f.store.startScheduledTopic('reader', f.handoff.topicId, '')
  expect(f.store.nextScheduledTopic('reader')).toBeUndefined()
  f.write('Fourth')
  f.review(run)
  expect(f.store.dependencies.pending('reader')).toMatchObject([{ sourceVersion: 4 }])
  expect(JSON.parse(f.store.getRun(run)!.input).handoffPin.source.version).toBe(3)
  f.review()
  expect(f.store.dependencies.pending('reader')).toEqual([])
})
it('ignores equivalent bodies and unrelated chapters, and does not follow one-off or ordinary fixed reads', () => {
  const f = fixture(); f.write('Original'); f.write('Another chapter', 'other')
  expect(f.store.dependencies.pending('reader')).toEqual([])
  const once = fixture(false); once.write('Changed')
  expect(once.store.dependencies.pending('reader')).toEqual([])
  const fixed = f.store.topics.create('reader', { title: 'Fixed', goal: 'Read v1', constraints: '' }, 'user')
  new ContactSources(f.store).read('reader', fixed.id, [f.handoff.source as Required<typeof f.handoff.source>])
  f.write('Changed')
  expect(f.store.dependencies.pending('reader').map(row => row.topicId)).toEqual([f.handoff.topicId])
})
it('persists publication and consumption across a database restart', () => {
  const f = fixture(true, true); f.write('Changed'); f.restart()
  expect(f.store.dependencies.pending('reader')).toMatchObject([{ sourceVersion: 2 }])
  expect(f.store.nextScheduledTopic('reader')).toBe(f.handoff.topicId)
  f.review(); f.restart(); expect(f.store.dependencies.pending('reader')).toEqual([])
})
it('does not wake for presentation changes or bypass a fixed calendar or paced interval', () => {
  const f = fixture(), artifact = f.store.deliveries.get(f.topic.id)!
  const run = f.store.revisePresentation('author', f.topic.id, f.store.topics.get('author', f.topic.id).revision, 'Change layout', '', artifact.version)
  f.store.finish(run, { runId: run, title: 'Layout', body: '', nextStep: '', evidence: [], createdAt: Date.now() }, [],
    { status: 'researching', judgement: 'Saved', nextStep: 'Continue', openQuestions: '', reason: 'Layout' },
    { completionCriteria: artifact.completionCriteria, stages: artifact.stages, summary: artifact.summary, presentation: { title: 'Layout', html: '<main>Reader</main>', css: '', script: '' } })
  expect(f.store.dependencies.pending('reader')).toEqual([])
  f.write('Changed')
  const settings = f.store.overview('reader').settings
  f.store.save('reader', { ...settings, paceWriting: true })
  expect(f.store.nextScheduledTopic('reader')).toBeUndefined()
  f.store.save('reader', settings)
  const rule = { cadence: 'daily' as const, times: ['23:59'] }
  f.store.topics.calendar('reader', f.handoff.topicId, f.store.topics.get('reader', f.handoff.topicId).revision, rule)
  f.store.calendars.save(f.handoff.topicId, rule, Date.now())
  expect(f.store.dependencies.pending('reader')).toHaveLength(1)
  expect(f.store.nextScheduledTopic('reader')).toBeUndefined()
})
it('backfills only explicit continuous handoffs with their persisted review watermark', () => {
  const f = fixture(true, true); f.write('Changed')
  f.store.db.exec('DROP TABLE delivery_dependencies'); f.restart()
  expect(f.store.dependencies.pending('reader')).toMatchObject([{ sourceVersion: 2 }])
  f.review(); f.store.db.exec('DROP TABLE delivery_dependencies'); f.restart()
  expect(f.store.dependencies.pending('reader')).toEqual([])
})
it('removes abandoned dependencies without treating a user pause as abandonment', () => {
  const f = fixture(); f.write('Changed')
  f.store.topics.status('reader', f.handoff.topicId, f.store.topics.get('reader', f.handoff.topicId).revision, 'abandoned', 'user')
  expect(f.store.dependencies.pending('reader')).toEqual([])
  expect(f.store.db.prepare('SELECT count(*) AS n FROM delivery_dependencies').get()).toEqual({ n: 0 })
})
it.each(['paused', 'waiting', 'manual', 'hours', 'budget', 'backoff'] as const)('retains the event without bypassing %s', boundary => {
  const f = fixture(); f.write('Changed')
  const settings = f.store.overview('reader').settings
  if (boundary === 'paused') f.store.topics.status('reader', f.handoff.topicId, f.store.topics.get('reader', f.handoff.topicId).revision, 'paused', 'user')
  if (boundary === 'waiting') { const run = f.store.createRun('reader', '', Date.now(), f.handoff.topicId); f.store.setStatus(run, 'waiting') }
  if (boundary === 'manual') f.store.save('reader', { ...settings, enabled: false })
  if (boundary === 'hours') { const hour = (new Date().getHours() + 2) % 24; f.store.save('reader', { ...settings, workHours: { start: `${String(hour).padStart(2,'0')}:00`, end: `${String((hour + 1) % 24).padStart(2,'0')}:00` } }) }
  if (boundary === 'budget') {
    const run = f.store.createRun('reader', '', Date.now(), f.handoff.topicId)
    f.store.charge(run); f.store.fail(run, 'network temporarily unavailable'); f.store.taskFailures.clear('reader', f.handoff.topicId)
    f.store.save('reader', { ...settings, dailyCalls: 2 })
  }
  if (boundary === 'backoff') { const run = f.store.createRun('reader', '', Date.now(), f.handoff.topicId); f.store.fail(run, 'network temporarily unavailable'); f.store.taskFailures.set('reader', f.handoff.topicId, run, 1, Date.now() + 60000) }
  expect(f.store.dependencies.pending('reader')).toHaveLength(1)
  expect(f.store.nextScheduledTopic('reader')).toBeUndefined()
})
it('hides revoked sources and rechecks permission after restoration without resuming a paused task', () => {
  const f = fixture(); f.write('Changed'); const settings = f.store.overview('author').settings
  f.store.save('author', { ...settings, shareDeliveries: false })
  expect(f.store.dependencies.pending('reader')).toEqual([])
  expect(f.store.nextScheduledTopic('reader')).toBeUndefined()
  expect(() => new ContactSources(f.store).read('reader', f.handoff.topicId, [{ ...f.handoff.source, sectionId: 'text', version: 2 }])).toThrow()
  f.store.save('author', settings)
  expect(f.store.dependencies.pending('reader')).toHaveLength(1)
  f.store.topics.status('reader', f.handoff.topicId, f.store.topics.get('reader', f.handoff.topicId).revision, 'paused', 'user')
  expect(f.store.nextScheduledTopic('reader')).toBeUndefined()
})
it('rolls events back with the outer completion transaction and removes deleted source relationships', () => {
  const f = fixture()
  f.store.db.exec("CREATE TRIGGER fail_completion BEFORE INSERT ON reports BEGIN SELECT RAISE(ABORT,'injected completion failure'); END")
  expect(() => f.write('Not committed')).toThrow('injected completion failure')
  expect(f.store.dependencies.pending('reader')).toEqual([])
  f.store.db.exec('DROP TRIGGER fail_completion'); f.write('Committed')
  expect(f.store.dependencies.pending('reader')).toHaveLength(1)
  f.store.deleteTopic('author', f.topic.id, f.store.topics.get('author', f.topic.id).revision)
  expect(f.store.dependencies.pending('reader')).toEqual([])
  expect(f.store.db.prepare('SELECT count(*) AS n FROM delivery_dependencies').get()).toEqual({ n: 0 })
})
