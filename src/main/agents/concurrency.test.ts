import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentService } from './service'
import { AgentStore } from './store'
import { DEFAULT_AGENT_SETTINGS, validateAgentSettings } from '../../shared/agents'
import { evidenceFromText } from './sources'
import { createContactTools } from './tools'
import type { ToolExecutionContext } from '../tools/registry'

const cleanups: (() => void | Promise<void>)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
const settings = { ...DEFAULT_AGENT_SETTINGS, goal: 'First', sources: ['https://example.com/'], permissionLevel: 'sources' as const, dailyCalls: 100 }
const config = { provider: 'openai' as const, baseUrl: 'https://example.com', apiKey: 'test', model: 'test', thinkingDisabledModels: [] }
const result = (question = '') => JSON.stringify({ title: 'Saved', body: 'Actual evidence [1].', nextStep: '', memories: [], question,
  progress: { judgement: 'Saved', openQuestions: question, nextStep: question ? 'Use the answer' : 'Continue research', reason: 'Saved evidence [1].', status: 'researching' } })

async function fixture(limit?: number, ignoreAbort = false) {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-task-concurrency-'))
  const pending: { signal: AbortSignal; resolve: (s: string) => void; reject: (e: Error) => void }[] = []
  const service = new AgentService(dir, () => {}, () => async (_prompt, signal) => new Promise<string>((resolve, reject) => {
    signal.throwIfAborted(); pending.push({ signal, resolve, reject })
    if (!ignoreAbort) signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
  }), async () => evidenceFromText(settings.sources[0], 'Actual evidence. '.repeat(100)))
  cleanups.push(async () => { for (const p of pending) p.reject(new Error('cleanup')); await service.close(); rmSync(dir, { recursive: true, force: true }) })
  await service.sync([{ id: 'alice', soul: '', conversation: '', config }])
  await service.request('save', 'alice', [{ ...settings, ...(limit === undefined ? {} : { maxConcurrentTasks: limit }) }])
  const first = service.store.overview('alice').topics[0].id
  const topics = [first, ...['Second', 'Third', 'Fourth'].map(title => {
    service.store.createTopic('alice', { title, goal: title, constraints: '' })
    return service.store.topics.list('alice').find(t => t.title === title)!.id
  })]
  const run = (index: number) => service.request('run', 'alice', [topics[index]])
  const saveLimit = (value: number) => service.request('savePreferences', 'alice', [{ ...service.store.overview('alice').settings, maxConcurrentTasks: value }])
  const active = () => service.store.overview('alice').runs.filter(r => r.status === 'running').map(r => r.topicId)
  return { service, pending, topics, run, saveLimit, active, dir }
}

it('persists the per-contact limit and rejects invalid counts without overwriting it', async () => {
  const f = await fixture(3)
  expect(f.service.store.overview('alice').settings).toMatchObject({ maxConcurrentTasks: 3 })
  for (const maxConcurrentTasks of [0, -1, 1.5, NaN, Infinity, '2', null]) {
    expect(() => validateAgentSettings({ ...settings, maxConcurrentTasks })).toThrow()
  }
  const reopened = new AgentStore(join(f.dir, 'agents.db'))
  try { expect(reopened.overview('alice').settings).toMatchObject({ maxConcurrentTasks: 3 }) } finally { reopened.close() }
})

it.each([undefined, 2])('runs at most the configured slots (%s) and drains queued tasks without duplicate execution', async limit => {
  const f = await fixture(limit), expected = limit ?? 1
  for (let i = 0; i < 3; i++) await f.run(i)
  await vi.waitFor(() => expect(f.active()).toHaveLength(expected))
  for (let i = 0; i < 5; i++) { f.service.tick(); await f.run(0) }
  expect(f.pending).toHaveLength(expected)
  expect(f.service.store.overview('alice').runs).toHaveLength(3)
  f.pending[0].resolve(result())
  await vi.waitFor(() => expect(f.pending).toHaveLength(expected + 1))
  expect(f.active()).toHaveLength(expected)
  expect(f.service.store.overview('alice').reports).toHaveLength(1)
})

it('applies increases immediately and drains decreases without cancelling active rounds', async () => {
  const f = await fixture(1)
  for (let i = 0; i < 4; i++) await f.run(i)
  await vi.waitFor(() => expect(f.pending).toHaveLength(1))
  await f.saveLimit(3)
  await vi.waitFor(() => expect(f.active()).toHaveLength(3))
  await f.saveLimit(1)
  expect(f.pending.every(p => !p.signal.aborted)).toBe(true)
  for (const index of [0, 1]) {
    f.pending[index].resolve(result())
    await vi.waitFor(() => expect(f.active()).toHaveLength(2 - index))
    expect(f.pending).toHaveLength(3)
  }
  f.pending[2].resolve(result())
  await vi.waitFor(() => expect(f.pending).toHaveLength(4))
  expect(f.active()).toEqual([f.topics[3]])
})

it('releases waiting slots and keeps answers bound to their task while others run', async () => {
  const f = await fixture(2)
  for (let i = 0; i < 3; i++) await f.run(i)
  await vi.waitFor(() => expect(f.pending).toHaveLength(2))
  f.pending[0].resolve(result('Which audience?'))
  await vi.waitFor(() => expect(f.pending).toHaveLength(3))
  const waiting = f.service.store.overview('alice').runs.find(r => r.topicId === f.topics[0])!
  expect(waiting.status).toBe('waiting')
  await f.service.request('answer', 'alice', [waiting.id, 'Developers'])
  expect(f.service.store.getRun(waiting.id)?.answer).toBe('Developers')
  expect(f.service.store.getRun(waiting.id)?.status).toBe('queued')
  expect(f.active()).toHaveLength(2)
})

it.each(['topicStatus', 'deleteTopic'] as const)('isolates %s and rejects late output without stopping the other task', async method => {
  const f = await fixture(2, true)
  await f.run(0); await f.run(1)
  await vi.waitFor(() => expect(f.pending).toHaveLength(2))
  const topic = f.service.store.topics.get('alice', f.topics[0])
  const operation = f.service.request(method, 'alice', [topic.id, topic.revision, 'paused', 'User paused'])
  expect(f.pending[0].signal.aborted).toBe(true)
  expect(f.pending[1].signal.aborted).toBe(false)
  await f.run(2)
  f.pending[1].resolve(result())
  await vi.waitFor(() => expect(f.active()).toContain(f.topics[2]))
  f.pending[0].resolve(result())
  await operation
  expect(f.service.store.overview('alice').reports).toHaveLength(1)
})

it('does not let a successful task reset another task failure backoff or stop its peers', async () => {
  const f = await fixture(2), s = f.service.store
  // Exercise persistence synchronously without starting the model.
  s.save('alice', { ...s.overview('alice').settings, enabled: true }, Date.now(), false)
  for (let i = 0; i < 3; i++) { const run = s.createRun('alice', '', Date.now(), f.topics[0]); s.fail(run, 'API error 503') }
  const due = s.providerRecovery('alice')!.at
  const other = s.createRun('alice', '', Date.now(), f.topics[1]); s.defer(other, 'Waiting for new evidence')
  expect(s.providerRecovery('alice')).toMatchObject({ topicId: f.topics[0], at: due })
  const third = s.assignTopic('alice', 'New assignment', '')
  expect(s.overview('alice').runs.some(r => r.topicId === third.id && r.status === 'queued')).toBe(true)
  const reopened = new AgentStore(join(f.dir, 'agents.db'))
  try { expect(reopened.providerRecovery('alice')).toMatchObject({ topicId: f.topics[0], at: due }) } finally { reopened.close() }
})

it('fills all automatic slots in one tick and leaves excess assignments pending', async () => {
  const f = await fixture(3), s = f.service.store
  s.changeTopic('alice', f.topics[0], s.topics.get('alice', f.topics[0]).revision, { status: 'paused', reason: 'Unused fixture task' })
  s.save('alice', { ...s.overview('alice').settings, enabled: true }, Date.now(), false)
  const tasks = ['A', 'B', 'C', 'D'].map(name => s.assignTopic('alice', name, ''))
  f.service.tick()
  await vi.waitFor(() => expect(f.active()).toHaveLength(3))
  expect(new Set(f.active())).toEqual(new Set(tasks.slice(0, 3).map(t => t.id)))
  expect(s.overview('alice').queuedTopicIds).toEqual([tasks[3].id])
})

it('keeps a replacement of a cancelled task queued until its old request really exits', async () => {
  const f = await fixture(3, true)
  await f.run(0); await f.run(1)
  await vi.waitFor(() => expect(f.pending).toHaveLength(2))
  const task = f.service.store.topics.get('alice', f.topics[0])
  await f.service.request('editTopic', 'alice', [task.id, task.revision, { title: task.title, goal: 'Changed goal', constraints: '' }, 'Change request'])
  await f.run(0)
  expect(f.pending).toHaveLength(2)
  f.pending[0].resolve(result())
  await vi.waitFor(() => expect(f.pending).toHaveLength(3))
  expect(f.service.store.overview('alice').reports).toHaveLength(0)
  expect(f.pending[1].signal.aborted).toBe(false)
})

it('keeps shared daily-call capacity queued before concurrently starting model requests', async () => {
  const f = await fixture(3), s = f.service.store
  s.save('alice', { ...s.overview('alice').settings, dailyCalls: 2 }, Date.now(), false)
  const runs = f.topics.slice(0, 3).map(id => s.createRun('alice', '', Date.now(), id))
  f.service.tick()
  await vi.waitFor(() => expect(f.pending).toHaveLength(2))
  expect(s.getRun(runs[2])?.status).toBe('queued')
  expect(s.callCount('alice')).toBe(2)
  f.pending[0].resolve(result()); f.pending[1].resolve(result())
  await vi.waitFor(() => expect(s.overview('alice').reports).toHaveLength(2))
  expect(s.getRun(runs[2])?.status).toBe('queued')
})

it('does not spend a second task Token allowance already reserved by an in-flight request', async () => {
  const f = await fixture(2), s = f.service.store
  s.save('alice', { ...s.overview('alice').settings, dailyTokenLimit: 20000 }, Date.now(), false)
  const runs = f.topics.slice(0, 2).map(id => s.createRun('alice', '', Date.now(), id))
  f.service.tick()
  await vi.waitFor(() => expect(s.overview('alice').runs.some(r => r.status === 'interrupted')).toBe(true))
  expect(f.pending).toHaveLength(1)
  expect(s.tokens.usage('alice').today).toBeLessThanOrEqual(20000)
  expect(s.callCount('alice')).toBe(1)
  expect(runs.filter(id => s.getRun(id)?.status === 'running')).toHaveLength(1)
})

it('restores interrupted rounds under the saved limit without reviving a paused task', async () => {
  const f = await fixture(2), s = f.service.store
  const runs = f.topics.slice(0, 3).map(id => s.createRun('alice', '', Date.now(), id))
  for (const id of runs) s.setStatus(id, 'running')
  const paused = s.topics.get('alice', f.topics[2])
  s.changeTopic('alice', paused.id, paused.revision, { status: 'paused', reason: 'Do not restart' })
  await f.service.close()
  const resumed = new AgentService(f.dir, () => {}, () => async (_prompt, signal) => new Promise<string>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cleanup')), { once: true })), async () => evidenceFromText(settings.sources[0], 'Evidence. '.repeat(100)))
  cleanups.push(() => resumed.close())
  expect(resumed.store.overview('alice').runs.filter(r => r.status === 'interrupted')).toHaveLength(2)
  await resumed.sync([{ id: 'alice', soul: '', conversation: '', config }])
  await vi.waitFor(() => expect(resumed.store.overview('alice').runs.filter(r => r.status === 'running')).toHaveLength(2))
  expect(resumed.store.getRun(runs[2])?.status).toBe('cancelled')
})

it('lets chat continue another task while a peer is running', async () => {
  const f = await fixture(2)
  await f.run(0)
  await vi.waitFor(() => expect(f.active()).toHaveLength(1))
  const topic = f.service.store.topics.get('alice', f.topics[1])
  const tool = createContactTools({ owner: () => 'alice', request: (...args) => f.service.request(...args) }).find(t => t.name === 'update_contact_topic')!
  const prepared = await tool.prepareAsync!({ topicId: topic.id, revision: topic.revision, action: 'continue', reason: 'Continue the second task' }, { sessionId: 'chat' } as ToolExecutionContext)
  await prepared.execute()
  await vi.waitFor(() => expect(f.active()).toHaveLength(2))
})

it('gives queued assignments a turn when a continuously producing task finishes a round', async () => {
  const f = await fixture(2), s = f.service.store
  s.save('alice', { ...s.overview('alice').settings, enabled: true }, Date.now(), false)
  s.createRun('alice', '', Date.now(), f.topics[0])
  const second = s.createRun('alice', '', Date.now(), f.topics[1])
  const waiting = s.assignTopic('alice', 'Waiting assignment', '')
  s.focusTopic('alice', f.topics[1])
  s.setStatus(second, 'completed')
  s.db.prepare('UPDATE task_schedule SET next_at=0 WHERE topic_id=?').run(f.topics[1])
  expect(s.nextScheduledTopic('alice')).toBe(waiting.id)
})

it('preserves legacy failure counts when upgrading during an unfinished retry', async () => {
  const f = await fixture(2), s = f.service.store
  for (let i = 0; i < 2; i++) { const run = s.createRun('alice', '', Date.now(), f.topics[0]); s.fail(run, 'API error 503') }
  const retry = s.createRun('alice', '', Date.now(), f.topics[0])
  s.db.exec('DROP TABLE task_failures') // Recreate the on-disk shape of the older serial build.
  const reopened = new AgentStore(join(f.dir, 'agents.db'))
  try {
    reopened.fail(retry, 'API error 503')
    expect(reopened.profile('alice')!.failures).toBe(3)
  } finally { reopened.close() }
})

it('allows a smaller task to use slots held by Token-blocked interrupted tasks', async () => {
  const f = await fixture(2), s = f.service.store
  s.save('alice', { ...s.overview('alice').settings, enabled: true, dailyTokenLimit: 10000 }, Date.now(), false)
  for (const topic of f.topics.slice(0, 2)) {
    const run = s.createRun('alice', '', Date.now(), topic)
    expect(s.tokens.reserve(run, 1, 'alice', topic, 'x'.repeat(11000), 2000).error).toBeDefined()
    s.fail(run, 'Token blocked')
    expect(s.getRun(run)?.status).toBe('interrupted')
  }
  const short = s.assignTopic('alice', 'Short task', '')
  expect(s.overview('alice').runs.some(r => r.topicId === short.id && r.status === 'queued')).toBe(true)
})

it('still offers a peer budget card when the oldest scheduled task has failed', async () => {
  const f = await fixture(2), s = f.service.store
  s.save('alice', { ...s.overview('alice').settings, enabled: true }, Date.now(), false)
  for (let i = 0; i < 3; i++) { const run = s.createRun('alice', '', Date.now(), f.topics[0]); s.fail(run, 'Invalid output') }
  const other = s.createRun('alice', '', Date.now(), f.topics[1])
  s.charge(other); s.charge(other); s.defer(other, 'Wait')
  s.db.prepare('UPDATE task_schedule SET next_at=0').run()
  s.save('alice', { ...s.overview('alice').settings, dailyCalls: 2 }, Date.now(), false)
  s.decisions.checkScheduledResources('alice')
  expect(s.decisions.pending('alice').some(card => card.topicId === f.topics[1] && card.kind === 'budget')).toBe(true)
})

it('reserves planning and execution together so one task can finish with two daily calls', async () => {
  const f = await fixture(2), s = f.service.store
  s.save('alice', { ...s.overview('alice').settings, sources: [], permissionLevel: 'public', dailyCalls: 2 }, Date.now(), false)
  const runs = f.topics.slice(0, 2).map(id => s.createRun('alice', '', Date.now(), id))
  f.service.tick()
  await vi.waitFor(() => expect(f.pending).toHaveLength(1))
  expect(s.getRun(runs[1])?.status).toBe('queued')
  f.pending[0].resolve(JSON.stringify({ action: 'write', reason: 'Produce text', query: '', urls: [], checkAfterMinutes: 180 }))
  await vi.waitFor(() => expect(f.pending).toHaveLength(2))
  f.pending[1].resolve(result())
  await vi.waitFor(() => expect(s.getRun(runs[0])?.status).toBe('completed'))
  expect(s.callCount('alice')).toBe(2)
  expect(s.getRun(runs[1])?.status).toBe('queued')
})

it('keeps a legacy focused task scheduled when increasing the limit and starting a peer', async () => {
  const f = await fixture(), s = f.service.store
  const old = s.createRun('alice', '', Date.now(), f.topics[0])
  s.setStatus(old, 'running')
  expect(s.scheduled('alice')).toHaveLength(0)
  s.save('alice', { ...s.overview('alice').settings, enabled: true, maxConcurrentTasks: 2 }, Date.now(), false)
  s.createRun('alice', '', Date.now(), f.topics[1]); s.focusTopic('alice', f.topics[1])
  s.setStatus(old, 'completed')
  s.db.prepare('UPDATE task_schedule SET next_at=0 WHERE topic_id=?').run(f.topics[0])
  expect(s.nextScheduledTopic('alice')).toBe(f.topics[0])
  expect(s.scheduled('alice').some(t => t.topic_id === f.topics[2])).toBe(false)
})

it('does not let a format repair consume the execution call reserved for another task', async () => {
  const f = await fixture(2), s = f.service.store
  s.save('alice', { ...s.overview('alice').settings, sources: [], permissionLevel: 'public', dailyCalls: 4 }, Date.now(), false)
  const runs = f.topics.slice(0, 2).map(id => s.createRun('alice', '', Date.now(), id))
  f.service.tick()
  await vi.waitFor(() => expect(f.pending).toHaveLength(2))
  f.pending[0].resolve('{}')
  await vi.waitFor(() => expect(s.getRun(runs[0])?.status).toBe('failed'))
  expect(f.pending).toHaveLength(2)
  f.pending[1].resolve(JSON.stringify({ action: 'write', reason: 'Produce text', query: '', urls: [], checkAfterMinutes: 180 }))
  await vi.waitFor(() => expect(f.pending).toHaveLength(3))
  f.pending[2].resolve(result())
  await vi.waitFor(() => expect(s.getRun(runs[1])?.status).toBe('completed'))
  expect(s.callCount('alice')).toBe(3)
})
