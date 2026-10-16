import { afterEach, expect, it } from 'vitest'
import { TaskCenter } from '../task-center/store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const stores: TaskCenter[] = []
afterEach(() => stores.splice(0).forEach(store => store.close()))
function fixture() {
  const store = new TaskCenter(':memory:'); stores.push(store)
  store.save('alice', { ...DEFAULT_AGENT_SETTINGS, goal: 'Write', enabled: false })
  const topic = store.topics.create('alice', { title: 'Draft', goal: 'Write', constraints: '' }, 'user')
  const runId = store.createRun('alice', '', Date.now(), topic.id)
  const context = { characterId: 'alice', skillId: 'writer', runId, topicId: topic.id, requestId: runId }
  return { store, context, finish: (fileIds: string[]) => store.finish(runId, { runId, title: 'Draft', body: 'Saved output', nextStep: 'Continue', evidence: [], createdAt: Date.now() }, [], { status: 'researching', judgement: 'Saved', reason: 'Saved', nextStep: 'Continue', openQuestions: '' }, { completionCriteria: 'Write', stages: [{ id: 'draft', title: 'Draft', status: 'active' }], summary: 'Saved', section: { id: 'text', title: 'Text', body: 'Saved output' }, fileIds }) }
}
it('keeps immutable bytes, request attribution and ownership; work files become formal only with a real commit', () => {
  const { store, context, finish } = fixture()
  const [first] = store.files.archive(context, [{ name: 'draft.md', bytes: Buffer.from('first') }])
  const [second] = store.files.archive(context, [{ name: 'draft.md', bytes: Buffer.from('second') }])
  expect(second.id).not.toBe(first.id)
  expect(store.files.archive(context, [{ name: 'draft.md', bytes: Buffer.from('first') }])[0].id).toBe(first.id)
  expect(Buffer.from(store.files.read('alice', first.id).bytes).toString()).toBe('first')
  expect(() => store.files.read('bob', first.id)).toThrow()
  expect(store.files.list('alice').every(f => !f.deliveryRef)).toBe(true)
  finish([first.id])
  expect(store.deliveries.get(context.topicId)?.fileIds).toEqual([first.id])
  expect(store.files.read('alice', first.id).file.deliveryRef?.version).toBe(1)
  expect(store.files.read('alice', second.id).file.deliveryRef).toBeUndefined()
})
it('rejects invalid names, limits, wrong run provenance and corrupt archived bytes without partial commits', () => {
  const { store, context, finish } = fixture()
  for (const name of ['../escape', '/absolute', 'C:\\bad', 'a/../../b', 'x\0y']) expect(() => store.files.archive(context, [{ name, bytes: Buffer.from('x') }])).toThrow()
  expect(() => store.files.archive(context, [{ name: 'large', bytes: Buffer.alloc(200 * 1024 + 1) }])).toThrow()
  expect(() => store.files.archive(context, Array.from({ length: 129 }, (_, n) => ({ name: String(n), bytes: Buffer.from('x') })))).toThrow()
  expect(() => store.files.archive(context, Array.from({ length: 43 }, (_, n) => ({ name: String(n), bytes: Buffer.alloc(200000) })))).toThrow()
  expect(() => store.files.archive({ ...context, characterId: 'bob' }, [{ name: 'x', bytes: Buffer.from('x') }])).toThrow()
  const [file] = store.files.archive(context, [{ name: 'x', bytes: Buffer.from('x') }])
  store.db.exec("CREATE TRIGGER fail_file_attach BEFORE UPDATE ON contact_files BEGIN SELECT RAISE(ABORT,'attach failure'); END")
  expect(() => finish([file.id])).toThrow('attach failure')
  expect(store.deliveries.get(context.topicId)).toBeNull()
  expect(store.files.read('alice', file.id).file.deliveryRef).toBeUndefined()
  store.db.exec('DROP TRIGGER fail_file_attach')
  store.db.prepare('UPDATE contact_file_bytes SET body=? WHERE hash=?').run(Buffer.from('tampered'), file.hash)
  expect(() => finish([file.id])).toThrow()
  expect(store.deliveries.get(context.topicId)).toBeNull()
})
it('commits bytes and metadata together, recovers immutable chat files on reopen and keeps cancelled work informal', () => {
  const root = mkdtempSync(join(tmpdir(), 'contact-file-archive-')), filename = join(root, 'files.db')
  let store = new TaskCenter(filename)
  try {
    store.ensure('alice'); store.memoryLibrary.registerSessions('alice', ['session'])
    const context = { characterId: 'alice', skillId: 'writer', sessionId: 'session', requestId: 'chat-request' }
    store.db.exec("CREATE TRIGGER fail_file BEFORE INSERT ON contact_files BEGIN SELECT RAISE(ABORT,'metadata failure'); END")
    expect(() => store.files.archive(context, [{ name: 'note.txt', bytes: Buffer.from('old bytes') }])).toThrow('metadata failure')
    expect(store.db.prepare('SELECT count(*) AS n FROM contact_file_bytes').get()).toEqual({ n: 0 })
    store.db.exec('DROP TRIGGER fail_file')
    const [file] = store.files.archive(context, [{ name: 'note.txt', bytes: Buffer.from('old bytes') }])
    store.close(); store = new TaskCenter(filename)
    expect(Buffer.from(store.files.read('alice', file.id).bytes).toString()).toBe('old bytes')
    expect(store.files.list('alice')[0].context).toEqual(context)
    expect(() => store.files.archive({ ...context, sessionId: 'foreign' }, [])).toThrow()
  } finally { store.close(); rmSync(root, { recursive: true, force: true }) }
  const { store: taskStore, context, finish } = fixture()
  const [file] = taskStore.files.archive(context, [{ name: 'draft.txt', bytes: Buffer.from('draft') }])
  taskStore.cancel('alice', 'Cancelled')
  expect(() => finish([file.id])).toThrow()
  expect(taskStore.files.read('alice', file.id).file.deliveryRef).toBeUndefined()
})
