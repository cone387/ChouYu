import { afterEach, expect, it } from 'vitest'
import { TaskCenter } from '../task-center/store'
import { buildContactContext } from './context'
import type { MemoryInput } from '../../shared/contact-memories'
const stores: TaskCenter[] = []
afterEach(() => stores.splice(0).forEach(s => s.close()))
it('uses the same explicit scope for chat and run context and rejects corrected snapshots', () => {
  const store = new TaskCenter(':memory:'); stores.push(store); store.ensure('alice'); store.ensure('bob')
  const a = store.topics.create('alice', { title: 'A', goal: 'A', constraints: '' }, 'test')
  const b = store.topics.create('alice', { title: 'B', goal: 'B', constraints: '' }, 'test')
  store.memoryLibrary.registerSessions('alice', ['chat'])
  const input: MemoryInput = { content: 'A only', kind: 'project', scope: { kind: 'task', topicId: a.id }, source: { kind: 'user', at: 1 } }
  const memory = store.memoryLibrary.create('alice', input)
  store.memoryLibrary.create('alice', { ...input, content: 'session only', scope: { kind: 'session', sessionId: 'chat' } })
  expect(buildContactContext(store, { characterId: 'alice', query: 'A' }).memories).toEqual([])
  expect(buildContactContext(store, { characterId: 'bob', query: 'A' }).memories).toEqual([])
  const context = buildContactContext(store, { characterId: 'alice', topicId: a.id, query: 'A' })
  expect(context.text).toContain('A only'); expect(context.text).not.toContain('session only')
  const runA = store.createRun('alice', '', Date.now(), a.id), runB = store.createRun('alice', '', Date.now(), b.id)
  expect(JSON.parse(store.getRun(runA)!.input).contextReferences.memories).toEqual(context.memories)
  expect(JSON.parse(store.getRun(runB)!.input).memories).toEqual([])
  store.memoryLibrary.update('alice', memory.id, 1, { ...input, content: 'corrected' })
  expect(() => store.assertContextCurrent('alice', context)).toThrow()
  expect(() => store.assertLive(runA)).toThrow()
  expect(store.assertLive(runB).id).toBe(runB)
  const beforeSchedule = store.scheduled('alice')
  expect(store.invalidateMemory('alice', memory.id)).toEqual([runA])
  expect(store.getRun(runA)?.status).toBe('cancelled')
  expect(store.getRun(runB)?.status).toBe('queued')
  expect(store.scheduled('alice')).toEqual(beforeSchedule)
  expect(JSON.parse(store.getRun(runA)!.input).memories).toEqual([])
})
it('exposes only actually supplied background memory versions and preserves references after corrections', () => {
  const store = new TaskCenter(':memory:'); stores.push(store); store.ensure('alice')
  const topic = store.topics.create('alice', { title: 'A', goal: 'A', constraints: '' }, 'test')
  const input: MemoryInput = { content: 'original', kind: 'project', scope: { kind: 'task', topicId: topic.id }, source: { kind: 'user', at: 1 } }
  const memory = store.memoryLibrary.create('alice', input), run = store.createRun('alice', '', Date.now(), topic.id)
  expect(store.detail('alice', run).run.contactContext).toBeUndefined()
  store.recordMemoryContext(run)
  expect(store.detail('alice', run).run.contactContext?.memories).toEqual([{ id: memory.id, revision: 1 }])
  store.memoryLibrary.update('alice', memory.id, 1, { ...input, content: 'corrected' })
  expect(store.detail('alice', run).run.contactContext?.memories).toEqual([{ id: memory.id, revision: 1 }])
  store.setStatus(run, 'failed')
  expect(store.detail('alice', run).run.contactContext?.status).toBe('failed')
  store.memoryLibrary.forget('alice', memory.id, 2)
  expect(store.memoryLibrary.history('alice', memory.id).every(m => !m.content)).toBe(true)
})
