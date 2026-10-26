import { expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ContactTaskStore } from '../task-center/contact-store'
import { WorkLoopHost } from './workloop-host'
import { ContactRecoveryGuard } from './recovery-guard'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { evidenceFromText } from '../agents/sources'

it('offers a contact-level review without tasks and keeps new task spending blocked', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'contact-empty-recovery-')), state = new Map<string, string>()
  const guard = new ContactRecoveryGuard(key => state.get(key) ?? null, (key, value) => { state.set(key, value) })
  guard.begin('group', 'restore', ['empty'])
  const host = new WorkLoopHost(directory, () => {})
  const identity = () => ({ id: 'empty', soul: '', conversation: '', config: null, recovery: guard.identity('empty') })
  try {
    await host.sync([identity()])
    expect(host.store.topics.list('empty')).toHaveLength(0)
    const [card] = await host.request('pendingInteractions', 'empty')
    expect(card?.storageRecovery).toMatchObject({ contactOnly: true })
    expect(await host.request('getInteraction', 'empty', [card.id])).toEqual(card)
    await expect(host.request('context', 'empty')).rejects.toThrow()
    guard.review({ restoreId: 'restore', requestId: 'scope-only', owner: 'empty', scopesReviewed: true,
      externalEffects: 'unresolved', evidence: 'Reviewed all restored memories and sharing scopes.' })
    await host.sync([identity()])
    await expect(host.request('context', 'empty')).resolves.toBeDefined()
    expect((await host.request('getInteraction', 'empty', [card.id])).status).toBe('resolved')
    expect(guard.identity('empty')?.allowedTopics).toEqual([])
    expect(guard.current()?.unknownHistory).toBe(true)
    expect(() => guard.reserve({ restoreId: 'restore', requestId: 'new-work', owner: 'empty', topicId: 'new', tokens: 1 })).toThrow()
  } finally { await host.close(); rmSync(directory, { recursive: true, force: true }) }
})

it('quarantines restored work, sources and outbox; only creates an idempotent new reviewed attempt', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'contact-recovered-'))
  const state = new Map<string, string>()
  const guard = new ContactRecoveryGuard(key => state.get(key) ?? null, (key, value) => { state.set(key, value) })
  let host: WorkLoopHost | undefined
  let source: ContactTaskStore | undefined
  try {
    const store = source = new ContactTaskStore(join(directory, 'agents.db'))
    store.save('alice', { ...DEFAULT_AGENT_SETTINGS, enabled: false, goal: 'Research', sources: ['https://example.com/'], permissionLevel: 'sources', dailyCalls: 2, dailyTokenLimit: 1000, shareDeliveries: true })
    const topic = store.overview('alice').focusTopicId!
    const finished = store.createRun('alice', '')
    store.charge(finished)
    const progress = { status: 'researching' as const, judgement: 'Saved', openQuestions: '', nextStep: 'Continue', reason: 'Evidence' }
    store.finish(finished, { runId: finished, title: 'Saved', body: 'Old formal body', nextStep: 'Continue', createdAt: Date.now(), evidence: [] }, [], progress)
    const original = store.createRun('alice', '')
    store.charge(original)
    const before = store.topics.get('alice', topic)
    store.topics.budget('alice', topic, before.revision, { modelCalls: 2, reason: 'original allowance' })
    store.remember('alice', 'restored private memory')
    store.close()
    guard.begin('group', 'restore', ['alice'])
    const report = JSON.stringify({ title: 'Saved', body: 'Evidence [1]', nextStep: 'Continue', memories: [], question: '', progress })
    const model = vi.fn(async () => report)
    host = new WorkLoopHost(directory, () => {}, () => model, async () => evidenceFromText('https://example.com/', 'Evidence. '.repeat(100)), undefined, undefined, undefined, {
      recoveryBudget: { reserve: async request => guard.reserve(request), settle: async (...args) => guard.settle(...args) }
    })
    const identity = () => ({ id: 'alice', soul: '', conversation: '', recovery: guard.identity('alice'), config: {
      provider: 'openai' as const, baseUrl: 'https://example.com', apiKey: 'test', model: 'test', thinkingDisabledModels: []
    } })
    await host.sync([identity()])
    host.tick()
    expect(model).not.toHaveBeenCalled()
    expect(host.store.getRun(original)?.status).toBe('failed')
    expect(await host.request('notices', 'alice')).toEqual([])
    await expect(host.request('context', 'alice')).rejects.toThrow(/核对/)
    await expect(host.request('assignTopic', 'alice', ['new task'])).rejects.toThrow(/核对/)
    const card = (await host.request('pendingInteractions', 'alice')).find(card => card.storageRecovery)!
    expect(card.topicId).toBe(topic)
    guard.review({ restoreId: 'restore', requestId: 'review', owner: 'alice', topicId: topic, scopesReviewed: true, externalEffects: 'verified',
      evidence: '用户已核对资料来源与所有外部操作的真实结果。', daily: { calls: 4, tokens: 1000000 }, task: { calls: 4, tokens: 1000000 } })
    await host.sync([identity()])
    await host.request('resumeRecovered', 'alice', [topic, 'restore', 'review'])
    await host.request('resumeRecovered', 'alice', [topic, 'restore', 'review'])
    await vi.waitFor(() => expect(host!.store.overview('alice').reports).toHaveLength(2))
    expect(model).toHaveBeenCalledOnce()
    expect(host.store.getRun(original)?.status).toBe('failed')
    expect(host.store.recovery.original('alice').runs).toContain(original)
    expect(guard.current()?.unknownHistory).toBe(true)
    expect(Object.keys(guard.current()!.requests)).toHaveLength(1)
  } finally { await host?.close(); if (source?.db.open) source.close(); rmSync(directory, { recursive: true, force: true }) }
})
