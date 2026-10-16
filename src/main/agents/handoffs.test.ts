import { afterEach, expect, it } from 'vitest'
import { AgentSpace } from '../agent-space/service'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn() })
async function fixture(execute = false) {
  const directory = mkdtempSync(join(tmpdir(), 'contact-handoff-'))
  let service = new AgentSpace(directory, () => {}, () => async (_prompt, signal) => new Promise<string>((_resolve, reject) => { signal.throwIfAborted(); signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }) }))
  cleanup.push(async () => { await service.close(); if (!directory.startsWith(join(tmpdir(), 'contact-handoff-'))) throw Error('Unexpected cleanup path'); rmSync(directory, { recursive: true, force: true }) })
  const identities = ['alice', 'bob'].map(id => ({ id, soul: id, conversation: '', config: execute ? { provider: 'openai' as const, baseUrl: 'https://example.invalid', apiKey: 'fixture', model: 'fixture', thinkingDisabledModels: [] } : null }))
  await service.sync(identities)
  for (const id of ['alice', 'bob']) service.store.save(id, { ...DEFAULT_AGENT_SETTINGS, goal: 'Work', enabled: false, shareDeliveries: true, readContactDeliveries: true })
  const topic = service.store.topics.create('alice', { title: 'Source', goal: 'Write', constraints: '' }, 'user')
  const runId = service.store.createRun('alice', '', Date.now(), topic.id)
  service.store.finish(runId, { runId, title: 'Saved', body: 'Source prose', nextStep: 'Continue', evidence: [], createdAt: Date.now() }, [], { status: 'researching', judgement: 'Saved', nextStep: 'Continue', openQuestions: '', reason: 'Draft' }, { completionCriteria: 'Write', stages: [{ id: 'draft', title: 'Draft', status: 'active' }], summary: 'Source', section: { id: 'text', title: 'Text', body: 'Actual source prose' } })
  const request = { requestId: 'review-1', source: { characterId: 'alice', topicId: topic.id, version: 1, sectionId: 'text' }, recipientId: 'bob', description: 'Review this draft once' }
  return { get service() { return service }, request, async reopen() { await service.close(); service = new AgentSpace(directory, () => {}); await service.sync(identities) } }
}
it('commits one actual receiver task atomically and replays it after restart without changing the author', async () => {
  const f = await fixture(), before = f.service.store.overview('alice'), receiverCount = f.service.store.topics.list('bob').length
  const prepared = await f.service.request('stageHandoff', 'alice', [f.request, { description: 'Review the saved draft once', requestLog: 'User review request', continuous: false }])
  expect(f.service.store.topics.list('bob')).toHaveLength(receiverCount)
  f.service.store.db.exec("CREATE TRIGGER fail_handoff BEFORE INSERT ON contact_handoffs BEGIN SELECT RAISE(ABORT,'handoff failure'); END")
  await expect(f.service.request('commitHandoff', 'alice', [prepared])).rejects.toThrow('handoff failure')
  expect(f.service.store.topics.list('bob')).toHaveLength(receiverCount)
  f.service.store.db.exec('DROP TRIGGER fail_handoff')
  const handoff = await f.service.request('commitHandoff', 'alice', [prepared])
  expect((await f.service.request('commitHandoff', 'alice', [prepared])).id).toBe(handoff.id)
  expect(f.service.store.topics.list('bob')).toHaveLength(receiverCount + 1)
  expect(f.service.store.overview('alice')).toEqual(before)
  await f.reopen()
  expect((await f.service.request('commitHandoff', 'alice', [prepared])).topicId).toBe(handoff.topicId)
  await expect(f.service.request('stageHandoff', 'alice', [{ ...f.request, description: 'Different request' }, { description: 'Different request', requestLog: '', continuous: false }])).rejects.toThrow()
})
it('retains the immutable source pin when the worker starts the newly assigned review', async () => {
  const f = await fixture(true)
  const prepared = await f.service.request('stageHandoff', 'alice', [f.request, { description: 'Review once', requestLog: '', continuous: false }])
  const handoff = await f.service.request('commitHandoff', 'alice', [prepared])
  const run = f.service.store.overview('bob').runs.find(r => r.topicId === handoff.topicId)!
  expect(JSON.parse(f.service.store.getRun(run.id)!.input).handoffPin?.source).toEqual(f.request.source)
})
it('validates both permissions, ownership and pinned version again on commit', async () => {
  const f = await fixture(), store = f.service.store, receiverCount = store.topics.list('bob').length
  const prepared = await f.service.request('stageHandoff', 'alice', [f.request, { description: 'Review once', requestLog: '', continuous: false }])
  store.save('alice', { ...store.overview('alice').settings, shareDeliveries: false })
  await expect(f.service.request('commitHandoff', 'alice', [prepared])).rejects.toThrow()
  expect(store.topics.list('bob')).toHaveLength(receiverCount)
  store.save('alice', { ...store.overview('alice').settings, shareDeliveries: true })
  store.save('bob', { ...store.overview('bob').settings, readContactDeliveries: false })
  await expect(f.service.request('commitHandoff', 'alice', [prepared])).rejects.toThrow()
  store.save('bob', { ...store.overview('bob').settings, readContactDeliveries: true })
  for (const source of [{ ...f.request.source, characterId: 'bob' }, { ...f.request.source, version: 999 }]) await expect(f.service.request('stageHandoff', 'alice', [{ ...f.request, source }, { description: 'Review', requestLog: '', continuous: false }])).rejects.toThrow()
})
it('projects actual review execution independently of the reviewed version', async () => {
  const f = await fixture(), store = f.service.store
  const prepared = await f.service.request('stageHandoff', 'alice', [f.request, { description: 'Review once', requestLog: '', continuous: false }])
  const handoff = await f.service.request('commitHandoff', 'alice', [prepared])
  const run = store.overview('bob').runs.find(r => r.topicId === handoff.topicId)!
  for (const status of ['queued', 'running', 'waiting', 'failed'] as const) {
    store.setStatus(run.id, status)
    expect(store.handoffs.state('alice', handoff.id).status).toBe(status)
  }
  store.topics.status('bob', handoff.topicId, store.topics.get('bob', handoff.topicId).revision, 'paused', 'Pause this task')
  expect(store.handoffs.state('alice', handoff.id).status).toBe('paused')
})
