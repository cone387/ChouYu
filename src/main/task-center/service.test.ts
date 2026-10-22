import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TaskCenter } from './service'
import { createTodoDomain } from './todo-domain'
import { createAssistantDomain } from './assistant-domain'
import { openTasksStore } from '../tasks/store'
import { AssistantRoutineService } from '../assistant-routines/service'
import { DEFAULT_CHARACTER_ID } from '../../shared/characters'
import { createContactDomain } from './contact-domain'
import { AgentSpace } from '../agent-space/service'
import { WorkLoopHost } from '../agent-space/workloop-host'
import { HarnessCoordinator } from '../harness/coordinator'
import { registryFor } from '../harness/test-utils'
import { DEFAULT_AGENT_SETTINGS, type AgentTopic } from '../../shared/agents'

const cleanup: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-task-center-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const filename = join(dir, 'todos.db'), store = openTasksStore(filename)
  cleanup.push(() => store.close())
  let raw = ''
  const history = new Map<string, string>()
  const service = new AssistantRoutineService({ read: () => raw, write: value => { raw = value },
    readHistory: id => history.get(id), writeHistory: (id, value) => { history.set(id, value) },
    generate: async () => 'A real saved routine result', deliver: () => {} })
  cleanup.push(() => service.close())
  const center = new TaskCenter()
  const registration = center.register(createTodoDomain(store))
  const todos = registration.bind('user')
  const routines = center.register(createAssistantDomain(service)).bind(DEFAULT_CHARACTER_ID)
  return { center, registration, todos, routines, filename, store, setRaw: (value: string) => { raw = value } }
}

it('dispatches real todo operations and retains independent date occurrences and persisted deletion', () => {
  const { center, todos, filename } = fixture()
  const dueAt = new Date(2026, 9, 19, 9).getTime()
  const task = todos.createTask({ title: 'Daily work', recurrence: 'daily', dueAt })
  todos.generateScheduledOccurrences(new Date(2026, 9, 20, 10).getTime())
  const all = todos.searchTasks({}).items
  expect(all.filter(item => item.title === 'Daily work')).toHaveLength(2)
  expect(all.every(item => item.status === 'open')).toBe(true)
  expect(center.read({ domain: 'todo', owner: 'user', id: task.id })).toMatchObject({ title: 'Daily work' })
  todos.deleteTask(task.id)
  expect(center.read({ domain: 'todo', owner: 'user', id: task.id })).toBeNull()
  const reopened = openTasksStore(filename)
  try { expect(reopened.getTask(task.id)).toBeNull(); expect(reopened.searchTasks({}).items).toHaveLength(1) }
  finally { reopened.close() }
})

it('preserves assistant revision checks and distinguishes missing tasks from unreadable state', () => {
  const { center, routines, setRaw } = fixture()
  const input = { title: 'Reminder', instruction: 'Remember the report', kind: 'reminder', cadence: 'daily', times: ['09:00'], enabled: true }
  const item = routines.save(input)[0]
  routines.save({ ...input, title: 'Changed' }, item.id, item.revision)
  expect(() => routines.remove(item.id, item.revision)).toThrow(/变化/)
  expect(center.read({ domain: 'assistant', owner: DEFAULT_CHARACTER_ID, id: item.id })).toMatchObject({ title: 'Changed', revision: 2 })
  expect(center.read({ domain: 'assistant', owner: DEFAULT_CHARACTER_ID, id: 'missing' })).toBeNull()
  setRaw('{bad')
  expect(() => center.read({ domain: 'assistant', owner: DEFAULT_CHARACTER_ID, id: 'missing' })).toThrow()
})

it('rejects foreign owners and unknown operations, and invalidates stale bindings on unregister', () => {
  const { center, registration, todos, store } = fixture()
  const task = todos.createTask({ title: 'Private' })
  expect(() => center.read({ domain: 'todo', owner: 'alice', id: task.id })).toThrow(/归属/)
  expect(() => center.list({ domain: 'assistant', owner: 'alice' })).toThrow(/归属/)
  expect(() => center.dispatchUnknown({ domain: 'todo', owner: 'user' }, 'close', [])).toThrow(/能力/)
  expect(() => center.dispatchUnknown({ domain: 'todo', owner: 'user' }, 'constructor', [])).toThrow(/能力/)
  expect(center.capabilities({ domain: 'todo', owner: 'user' })).toContain('completeTask')
  registration.dispose()
  center.register(createTodoDomain(store))
  expect(() => todos.completeTask(task.id)).toThrow(/卸载/)
  expect(store.getTask(task.id)?.status).toBe('open')
})

it('routes contact tasks through their actual module and preserves owner and revision checks', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-task-domain-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  const host = new WorkLoopHost(dir, () => {})
  cleanup.push(() => host.close())
  const identities = ['alice', 'bob'].map(id => ({ id, soul: id, conversation: '', config: null }))
  await host.sync(identities)
  for (const owner of identities) await host.request('save', owner.id, [{ ...DEFAULT_AGENT_SETTINGS, goal: 'Write an article' }])
  const space = new AgentSpace({ readIdentity: id => identities.find(item => item.id === id),
    harness: new HarnessCoordinator(registryFor({ native: { run: async () => ({ state: 'completed', text: 'hello' }) } })),
    work: { request: (method, owner, args) => host.request(method, owner, args), detach: owner => host.detachModule(owner, 'workloop'), remove: owner => host.remove(owner) } })
  cleanup.push(() => space.close())
  const center = new TaskCenter(), registration = center.register(createContactDomain(space)), alice = registration.bind('alice')
  const topic = (await center.list({ domain: 'contact', owner: 'alice' }) as AgentTopic[])[0]
  await expect(center.read({ domain: 'contact', owner: 'bob', id: topic.id })).rejects.toThrow()
  await alice.topicStatus(topic.id, topic.revision, 'paused', 'User paused')
  await expect(alice.deleteTopic(topic.id, topic.revision)).rejects.toThrow(/变化/)
  expect(await center.read({ domain: 'contact', owner: 'alice', id: topic.id })).toMatchObject({ topic: { status: 'paused' } })
  await space.detachModule('alice', 'workloop')
  await expect(center.read({ domain: 'contact', owner: 'alice', id: topic.id })).rejects.toThrow(/未启用/)
  await space.attachModule('alice', 'workloop')
  const current = host.store.topics.get('alice', topic.id)
  await alice.deleteTopic(current.id, current.revision)
  expect(await center.list({ domain: 'contact', owner: 'alice' })).toEqual([])
})
