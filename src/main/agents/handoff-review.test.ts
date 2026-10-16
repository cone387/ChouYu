import { afterEach, expect, it } from 'vitest'
import { TaskCenter } from '../task-center/store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
const stores: TaskCenter[] = []
afterEach(() => stores.splice(0).forEach(s => s.close()))
function fixture(continuous = false) {
  const store = new TaskCenter(':memory:'); stores.push(store)
  for (const id of ['author', 'reviewer']) store.save(id, { ...DEFAULT_AGENT_SETTINGS, goal: 'Work', enabled: false, shareDeliveries: true, readContactDeliveries: true })
  const topic = store.topics.create('author', { title: 'Draft', goal: 'Write', constraints: '' }, 'user')
  const write = (body: string) => {
    const runId = store.createRun('author', '', Date.now(), topic.id)
    store.finish(runId, { runId, title: 'Draft', body, nextStep: 'Continue', evidence: [], createdAt: Date.now() }, [], { status: 'researching', judgement: 'Saved', nextStep: 'Continue', openQuestions: '', reason: 'Draft' }, { completionCriteria: 'Write', stages: [{ id: 'draft', title: 'Draft', status: 'active' }], summary: 'Saved', section: { id: 'text', title: 'Text', body } })
  }
  write('Original')
  const prepared = store.handoffs.stage('author', { requestId: 'h', source: { characterId: 'author', topicId: topic.id, version: 1, sectionId: 'text' }, recipientId: 'reviewer', description: 'Review' }, { description: 'Review', requestLog: 'Review', continuous })
  const handoff = store.handoffs.commit('author', prepared)
  const review = () => {
    const runId = store.createRun('reviewer', '', Date.now(), handoff.topicId)
    store.handoffs.bindRun(runId)
    store.finish(runId, { runId, title: 'Review', body: 'Consider simplifying the opening.', nextStep: '', evidence: store.handoffs.evidence(runId), createdAt: Date.now() }, [], { status: 'completed', judgement: 'Reviewed', nextStep: '', openQuestions: '', reason: 'Saved review' }, { completionCriteria: 'Review', stages: [{ id: 'review', title: 'Review', status: 'done' }], summary: 'Review complete', section: { id: 'opinion', title: 'Opinion', body: 'Consider simplifying the opening.' } })
    return runId
  }
  return { store, topic, handoff, write, review }
}
it('keeps a one-off review tied to v1 and rejects returning it against an unreviewed v2', () => {
  const { store, topic, handoff, write, review } = fixture()
  review(); write('New draft')
  expect(store.handoffs.state('author', handoff.id)).toMatchObject({ reviewedVersion: 1, latestVersion: 2 })
  expect(store.handoffs.needsReview('reviewer', handoff.topicId)).toBe(false)
  expect(() => store.handoffs.returnReview('author', { handoffId: handoff.id, review: { ref: { characterId: 'reviewer', topicId: handoff.topicId, version: 1, sectionId: 'opinion' } }, source: { ref: { ...handoff.source, version: 2 } }, feedback: 'Use this suggestion', topicRevision: store.topics.get('author', topic.id).revision }, '')).toThrow()
  expect(store.topics.get('author', topic.id).status).toBe('researching')
})
it('waits for changed text, ignores equivalent versions and never revives paused or revoked work', () => {
  const { store, handoff, write, review } = fixture(true)
  review(); expect(store.handoffs.needsReview('reviewer', handoff.topicId)).toBe(false)
  write('Original'); expect(store.handoffs.needsReview('reviewer', handoff.topicId)).toBe(false)
  write('Changed'); expect(store.handoffs.needsReview('reviewer', handoff.topicId)).toBe(true)
  const topic = store.topics.get('reviewer', handoff.topicId)
  store.topics.status('reviewer', topic.id, topic.revision, 'paused', 'user')
  expect(store.handoffs.needsReview('reviewer', topic.id)).toBe(false)
  store.save('author', { ...store.overview('author').settings, shareDeliveries: false })
  expect(store.handoffs.needsReview('reviewer', topic.id)).toBe(false)
})
