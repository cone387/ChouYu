import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkLoopHost } from '../agent-space/workloop-host'
import { ContactTaskStore } from '../task-center/contact-store'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { evidenceFromText } from './sources'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.useRealTimers()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

const settings = { ...DEFAULT_AGENT_SETTINGS, goal: '核对需求', sources: ['https://example.com/'] }
const config = { provider: 'openai' as const, baseUrl: 'https://example.com', apiKey: 'test', model: 'test', thinkingDisabledModels: [] }
const draft = JSON.stringify({ title: '本轮判断', body: '资料 [1] 有需求线索，待验证。', nextStep: '继续核对', memories: [], question: '',
  progress: { judgement: '需求尚待验证', openQuestions: '是否愿意付费', nextStep: '继续核对', reason: '根据资料 [1]', status: 'needs_evidence' } })
type Pending = { signal: AbortSignal; resolve: (value: string) => void; reject: (error: Error) => void }

async function fixture(ignoreAbort = false) {
  const directory = mkdtempSync(join(tmpdir(), 'chouyu-concurrent-agents-'))
  const calls = new Map<string, Pending[]>()
  const service = new WorkLoopHost(directory, () => {}, identity => async (_prompt, signal) => {
    return new Promise<string>((resolve, reject) => {
      signal.throwIfAborted()
      calls.set(identity.id, [...(calls.get(identity.id) ?? []), { signal, resolve, reject }])
      if (!ignoreAbort) signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
    })
  }, async () => evidenceFromText(settings.sources[0], '<title>访谈</title>' + '需求仍需验证。'.repeat(30)))
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    // Release even deliberately uncooperative test requests before closing storage.
    for (const requests of calls.values()) for (const request of requests) request.reject(new Error('cleanup'))
    await service.close()
  }
  cleanups.push(async () => { await close(); rmSync(directory, { recursive: true, force: true }) })
  await service.sync(['alice', 'bob', 'charlie'].map(id => ({ id, soul: id, conversation: '', config })))
  for (const id of ['alice', 'bob', 'charlie']) await service.request('save', id, [settings])
  const start = async (id: string) => {
    const count = calls.get(id)?.length ?? 0
    const data = await service.request('run', id)
    await vi.waitFor(() => expect(calls.get(id)).toHaveLength(count + 1))
    return data.runs[0].id as string
  }
  const pending = (id: string) => calls.get(id)!.at(-1)!
  return { service, calls, start, pending, close }
}

it('runs different contacts concurrently, deduplicates ticks, and lets a fast contact finish independently', async () => {
  const f = await fixture()
  const alice = await f.start('alice'), bob = await f.start('bob')
  for (let i = 0; i < 3; i++) { f.service.tick(); await f.service.request('run', 'alice') }
  expect(f.calls.get('alice')).toHaveLength(1)
  expect(f.service.store.getRun(alice)?.status).toBe('running')
  f.pending('bob').resolve(draft)
  await vi.waitFor(() => expect(f.service.store.getRun(bob)?.status).toBe('completed'))
  expect(f.service.store.getRun(alice)?.status).toBe('running')
  expect(f.service.store.callCount('alice')).toBe(1)
  expect(f.service.store.callCount('bob')).toBe(1)
  f.pending('alice').resolve(draft)
  await vi.waitFor(() => expect(f.service.store.getRun(alice)?.status).toBe('completed'))
})

it('updates shared limits and notifications without aborting an active round or resetting its usage', async () => {
  const f = await fixture()
  const run = await f.start('alice')
  const before = f.service.store.overview('alice')
  const next = await f.service.request('savePreferences', 'alice', [{ ...before.settings, dailyCalls: 40, notifyProgress: false, intervalMinutes: 30 }])
  expect(f.pending('alice').signal.aborted).toBe(false)
  expect(f.service.store.getRun(run)?.status).toBe('running')
  expect(next.revision).toBe(before.revision + 1)
  expect(f.service.store.getRun(run)?.revision).toBe(next.revision)
  expect(next.callsToday).toBe(before.callsToday)
  expect(next.topics).toEqual(before.topics)
  f.pending('alice').resolve(draft)
  await vi.waitFor(() => expect(f.service.store.getRun(run)?.status).toBe('completed'))
})

it('preserves a waiting question when the daily allowance changes, and still stops on access changes', async () => {
  const f = await fixture()
  const run = await f.start('alice')
  f.pending('alice').resolve(JSON.stringify({ ...JSON.parse(draft), question: '需要哪个方向？' }))
  await vi.waitFor(() => expect(f.service.store.getRun(run)?.status).toBe('waiting'))
  const before = f.service.store.overview('alice')
  await f.service.request('savePreferences', 'alice', [{ ...before.settings, dailyCalls: 30 }])
  expect(f.service.store.getRun(run)?.status).toBe('waiting')
  await f.service.request('savePreferences', 'alice', [{ ...before.settings, permissionLevel: 'sources', dailyCalls: 30 }])
  expect(f.service.store.getRun(run)?.status).toBe('cancelled')
})

it('ignores obsolete deadlines when enabling automatic work without cancelling the active round', async () => {
  const f = await fixture()
  const run = await f.start('alice')
  const before = f.service.store.overview('alice')
  await f.service.dispatchUnknown('savePreferences', 'alice', [{ ...before.settings, enabled: true, workUntil: Date.now() - 1 }])
  expect(f.service.store.overview('alice').settings).toEqual({ ...before.settings, enabled: true })
  expect(f.pending('alice').signal.aborted).toBe(false)
  expect(f.service.store.getRun(run)?.status).toBe('running')
})

it('automatically starts all due contacts and isolates a failed model request', async () => {
  const f = await fixture()
  for (const id of ['alice', 'bob']) f.service.store.save(id, { ...settings, enabled: true })
  f.service.tick()
  await vi.waitFor(() => {
    expect(f.calls.get('alice')).toHaveLength(1)
    expect(f.calls.get('bob')).toHaveLength(1)
  })
  f.pending('alice').reject(new Error('model unavailable'))
  await vi.waitFor(() => expect(f.service.store.overview('alice').runs[0].status).toBe('failed'))
  expect(f.pending('bob').signal.aborted).toBe(false)
  f.pending('bob').resolve(draft)
  await vi.waitFor(() => expect(f.service.store.overview('bob').reports).toHaveLength(1))
  expect(f.service.store.overview('alice').reports).toHaveLength(0)
  expect(f.calls.has('charlie')).toBe(false)
})

it.each([
  ['API error 503: Controlled contact endurance HTTP 503', 'network'],
  ['API error 429: 余额不足，authorization=fixture-secret', 'billing'],
  ['API error 401: invalid api key fixture-secret', 'configuration'],
  ['API error 503: https://fixture-secret.invalid/?token=fixture-secret', 'network'],
  ['unexpected failure token=fixture-secret', 'unknown'],
  ['接单计划纠正后仍无效，尚未保存或交付正文。', 'format']
])('preserves the actionable cause of an assignment failure: %s', async (message, kind) => {
  const f = await fixture()
  await f.service.request('assignTopic', 'alice', ['写一段正文'])
  await vi.waitFor(() => expect(f.calls.get('alice')).toHaveLength(1))
  const run = f.service.store.overview('alice').runs[0].id
  f.pending('alice').reject(new Error(message))
  await vi.waitFor(() => expect(f.service.store.getRun(run)?.status).toBe('failed'))
  const card = f.service.store.decisions.pending('alice').find(c => c.runId === run)!
  expect(card.failure?.kind).toBe(kind)
  expect(f.service.store.getRun(run)?.error).not.toContain('fixture-secret')
  expect(card.failureDetail).not.toContain('fixture-secret')
  expect(f.service.store.overview('alice').reports).toHaveLength(0)
  expect(f.service.store.callCount('alice')).toBe(1)
})

it('keeps a redacted provider outage recognizable after planning too', async () => {
  const f = await fixture(), run = await f.start('alice')
  f.pending('alice').reject(new Error('API error 503: https://fixture-secret.invalid/?token=fixture-secret'))
  await vi.waitFor(() => expect(f.service.store.getRun(run)?.status).toBe('failed'))
  expect(f.service.store.decisions.pending('alice').find(c => c.runId === run)?.failure?.kind, f.service.store.getRun(run)?.error).toBe('network')
  expect(f.service.store.getRun(run)?.error).not.toContain('fixture-secret')
})

it('retains low-frequency provider recovery after three failed assignment requests and database reopen', async () => {
  const began = Date.now()
  const clock = vi.spyOn(Date, 'now').mockReturnValue(began)
  cleanups.push(async () => { clock.mockRestore() })
  const f = await fixture()
  await f.service.request('assignTopic', 'alice', ['写一段正文'])
  let topicId = '', runId = ''
  for (let attempt = 1; attempt <= 3; attempt++) {
    clock.mockReturnValue(began + attempt * 1000)
    if (attempt > 1) await f.service.request('run', 'alice', [topicId])
    await vi.waitFor(() => expect(f.calls.get('alice')).toHaveLength(attempt))
    const run = f.service.store.overview('alice').runs[0]
    topicId = run.topicId!; runId = run.id
    f.pending('alice').reject(new Error('API error 503: authorization=fixture-secret'))
    await vi.waitFor(() => expect(f.service.store.getRun(run.id)?.status).toBe('failed'))
  }
  f.service.store.save('alice', { ...f.service.store.overview('alice').settings, enabled: true }, Date.now(), false)
  const reopened = new ContactTaskStore(f.service.store.db.name)
  cleanups.push(async () => reopened.close())
  const due = reopened.providerRecovery('alice')!.at
  expect(due).toBe(began + 903000)
  expect(reopened.taskFailures.get(topicId)?.failures).toBe(3)
  expect(reopened.decisions.pending('alice').find(c => c.runId === runId)).toMatchObject({ failure: { kind: 'network' }, automaticRetryAt: due })
  expect(reopened.overview('alice').reports).toHaveLength(0)
  expect(reopened.callCount('alice')).toBe(3)
})

it('pauses only the selected contact and keeps its replacement queued until the old execution exits', async () => {
  const f = await fixture(true)
  const alice = await f.start('alice'), bob = await f.start('bob')
  const previous = f.pending('alice')
  await f.service.request('pause', 'alice')
  expect(previous.signal.aborted).toBe(true)
  expect(f.pending('bob').signal.aborted).toBe(false)
  await f.service.request('run', 'alice')
  f.service.tick()
  expect(f.calls.get('alice')).toHaveLength(1)
  expect(f.service.store.overview('alice').runs.some(run => run.status === 'queued')).toBe(true)
  previous.resolve(draft)
  await vi.waitFor(() => expect(f.calls.get('alice')).toHaveLength(2))
  expect(f.service.store.getRun(alice)?.status).toBe('cancelled')
  expect(f.service.store.overview('alice').reports).toHaveLength(0)
  f.pending('bob').resolve(draft)
  await vi.waitFor(() => expect(f.service.store.getRun(bob)?.status).toBe('completed'))
})

it.each(['remove', 'deleteTopic'] as const)('does not stop scheduling other contacts while %s waits for cancellation', async method => {
  const f = await fixture(true)
  await f.start('alice')
  const topic = f.service.store.overview('alice').topics[0]
  const deleting = method === 'remove'
    ? f.service.remove('alice')
    : f.service.request('deleteTopic', 'alice', [topic.id, topic.revision])
  // Cancellation is intentionally slow, but another contact can start and finish.
  const bob = await f.start('bob')
  f.pending('bob').resolve(draft)
  await vi.waitFor(() => expect(f.service.store.getRun(bob)?.status).toBe('completed'))
  f.pending('alice').resolve(draft)
  await deleting
  if (method === 'remove') expect(f.service.store.profile('alice')).toBeUndefined()
  else expect(f.service.store.overview('alice').topics).toHaveLength(0)
  expect(f.service.store.db.prepare('SELECT * FROM reports WHERE character_id=?').all('alice')).toHaveLength(0)
})

it('does not impose a two-minute whole-run deadline and can still pause a long-running contact', async () => {
  vi.useFakeTimers()
  const f = await fixture()
  const run = await f.start('alice')
  await vi.advanceTimersByTimeAsync(180_000)
  expect(f.pending('alice').signal.aborted).toBe(false)
  expect(f.service.store.getRun(run)?.status).toBe('running')
  await f.service.request('pause', 'alice')
  expect(f.pending('alice').signal.aborted).toBe(true)
  expect(f.service.store.getRun(run)?.status).toBe('cancelled')
})

it('does not cancel active work because an obsolete deadline exists', async () => {
  const f = await fixture()
  const alice = await f.start('alice'), bob = await f.start('bob')
  f.service.store.db.prepare('UPDATE profiles SET settings=? WHERE character_id=?')
    .run(JSON.stringify({ ...settings, enabled: true, workUntil: Date.now() - 1 }), 'alice')
  f.service.tick()
  expect(f.pending('alice').signal.aborted).toBe(false)
  expect(f.service.store.getRun(alice)?.status).toBe('running')
  expect(f.service.store.nextScheduledTopic('alice')).toBeUndefined()
  f.pending('alice').resolve(draft)
  expect(f.pending('bob').signal.aborted).toBe(false)
  f.pending('bob').resolve(draft)
  await vi.waitFor(() => expect(f.service.store.getRun(bob)?.status).toBe('completed'))
})

it('aborts every active contact on shutdown and records each interrupted execution before closing storage', async () => {
  const f = await fixture()
  const alice = await f.start('alice'), bob = await f.start('bob')
  const status = vi.spyOn(f.service.store, 'setStatus')
  await f.close()
  expect(f.pending('alice').signal.aborted).toBe(true)
  expect(f.pending('bob').signal.aborted).toBe(true)
  expect(status).toHaveBeenCalledWith(alice, 'interrupted')
  expect(status).toHaveBeenCalledWith(bob, 'interrupted')
})
