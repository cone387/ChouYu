import { expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkLoopHost } from './workloop-host'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { evidenceFromText } from '../agents/sources'
import { AgentSpace } from './service'
import { HarnessCoordinator } from '../harness/coordinator'
import { registryFor } from '../harness/test-utils'
import type { HarnessInput } from '../harness/contracts'
import { DEFAULT_APP_CONFIG } from '../../shared/config'

const identity = (id: string) => ({ id, soul: id, conversation: '', config: null })
const input = (id: string): HarnessInput => ({ requestId: `request:${id}`, attemptId: `attempt:${id}`, characterId: id,
  messages: [{ role: 'user', content: 'hello' }], systemPrompt: id, config: DEFAULT_APP_CONFIG,
  configVersion: 'v', snapshotFingerprint: 's', signal: new AbortController().signal, assertContext: async () => {} })
function fixture(harness = new HarnessCoordinator(registryFor({ native: { run: async value => ({ state: 'completed', text: value.systemPrompt }) } }))) {
  const live = new Set(['alice', 'bob']), closed: string[] = [], calls: string[] = []
  const space = new AgentSpace({ harness, readIdentity: id => live.has(id) ? identity(id) : undefined,
    work: { request: async (method, id) => { calls.push(`${id}:${method}`); return { owner: id } },
      detach: async id => { closed.push(id) }, remove: async id => { live.delete(id) } } })
  return { space, live, closed, calls }
}

it('runs chat and work through the same contact while enforcing independently detached capabilities', async () => {
  const { space, calls } = fixture()
  expect(await space.runChat(input('alice'), () => {})).toMatchObject({ state: 'completed', text: 'alice' })
  expect(await space.request('get', 'alice')).toEqual({ owner: 'alice' })
  await space.detachModule('alice', 'chat')
  await expect(space.runChat(input('alice'), () => {})).rejects.toThrow(/聊天.*未启用/)
  expect(await space.request('get', 'alice')).toEqual({ owner: 'alice' })
  expect(await space.runChat(input('bob'), () => {})).toMatchObject({ state: 'completed', text: 'bob' })
  expect(calls).toEqual(['alice:get', 'alice:get'])
  await space.close()
})

it('waits for one contact chat to actually exit during detach and leaves its peer running', async () => {
  let release!: () => void, entered!: () => void
  const hold = new Promise<void>(resolve => { release = resolve }), started = new Promise<void>(resolve => { entered = resolve })
  let aliceSignal: AbortSignal | undefined
  const harness = new HarnessCoordinator(registryFor({ native: { run: async value => {
    if (value.characterId === 'alice') { aliceSignal = value.signal; entered(); await hold }
    return { state: 'completed', text: value.systemPrompt }
  } } }))
  const { space } = fixture(harness)
  const running = space.runChat(input('alice'), () => {})
  await started
  let detached = false
  const detach = space.detachModule('alice', 'chat').then(() => { detached = true })
  try {
    expect(aliceSignal!.aborted).toBe(true)
    expect(detached).toBe(false)
    expect(await space.runChat(input('bob'), () => {})).toMatchObject({ state: 'completed', text: 'bob' })
  } finally { release(); await detach }
  expect(await running).toMatchObject({ state: 'cancelled' })
  await space.close()
})

it('rejects deleted and unowned contacts and does not recreate an identity while removal is in flight', async () => {
  const { space, live } = fixture()
  await expect(space.runChat(input('missing'), () => {})).rejects.toThrow(/联系人/)
  await expect(space.runChat({ ...input('alice'), characterId: undefined }, () => {})).rejects.toThrow(/联系人/)
  await space.request('get', 'alice')
  await space.remove('alice')
  live.add('alice') // a stale main-process roster must not revive the retiring contact
  await expect(space.request('get', 'alice')).rejects.toThrow(/删除/)
  await Promise.all([space.close(), space.close()])
  await expect(space.runChat(input('bob'), () => {})).rejects.toThrow(/关闭/)
})

it('composes real persisted work with chat and can remount the worker module after cancellation', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-app-space-'))
  const owner = { ...identity('alice'), config: { provider: 'openai' as const, baseUrl: 'https://example.com', apiKey: 'test', model: 'test', thinkingDisabledModels: [] } }
  const requests: AbortSignal[] = []
  const host = new WorkLoopHost(dir, () => {}, () => async (_prompt, signal) => new Promise<string>((_resolve, reject) => {
    requests.push(signal)
    signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
  }), async () => evidenceFromText('https://example.com/', 'Evidence. '.repeat(100)))
  const harness = new HarnessCoordinator(registryFor({ native: { run: async () => ({ state: 'completed', text: 'hello' }) } }))
  const space = new AgentSpace({ harness, readIdentity: id => id === owner.id ? owner : undefined,
    work: { request: (method, id, args) => host.request(method, id, args), detach: id => host.detachModule(id, 'workloop'), remove: id => host.remove(id) } })
  try {
    await host.sync([owner])
    await space.request('save', owner.id, [{ ...DEFAULT_AGENT_SETTINGS, goal: 'Research', sources: ['https://example.com/'], permissionLevel: 'sources', dailyCalls: 100 }])
    await space.request('run', owner.id)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    await space.detachModule(owner.id, 'workloop')
    expect(requests[0].aborted).toBe(true)
    await expect(space.request('get', owner.id)).rejects.toThrow(/未启用/)
    expect(await space.runChat(input(owner.id), () => {})).toMatchObject({ state: 'completed', text: 'hello' })
    await space.attachModule(owner.id, 'workloop')
    expect((await space.request('get', owner.id)).settings.goal).toBe('Research')
    await space.request('run', owner.id)
    await vi.waitFor(() => expect(requests).toHaveLength(2))
    await space.remove(owner.id)
    expect(requests[1].aborted).toBe(true)
    expect(host.store.profile(owner.id)).toBeUndefined()
  } finally { await space.close(); await host.close(); rmSync(dir, { recursive: true, force: true }) }
})

it('keeps a detached WorkLoop disabled across worker replacement until explicitly attached', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-unloaded-restart-'))
  const owners = ['alice', 'bob'].map(id => ({ ...identity(id), config: { provider: 'openai' as const, baseUrl: 'https://example.com', apiKey: 'test', model: 'test', thinkingDisabledModels: [] } }))
  const entered: string[] = []
  const makeHost = () => new WorkLoopHost(dir, () => {}, owner => async (_prompt, signal) => {
    entered.push(owner.id)
    return new Promise<string>((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }))
  }, async () => evidenceFromText('https://example.com/', 'Evidence. '.repeat(100)))
  let host = makeHost()
  const space = new AgentSpace({ harness: new HarnessCoordinator(registryFor({ native: { run: async () => ({ state: 'completed', text: 'hello' }) } })), readIdentity: id => owners.find(owner => owner.id === id),
    work: { request: (method, id, args) => host.request(method, id, args), detach: id => host.detachModule(id, 'workloop'), remove: id => host.remove(id) } })
  try {
    await host.sync(owners.map(owner => space.workerIdentity(owner)))
    for (const owner of owners) await space.request('save', owner.id, [{ ...DEFAULT_AGENT_SETTINGS, enabled: false, goal: 'Fixture', sources: ['https://example.com/'], permissionLevel: 'sources', dailyCalls: 100 }])
    await space.detachModule('alice', 'workloop')
    await host.close(); host = makeHost()
    await host.sync(owners.map(owner => space.workerIdentity(owner)))
    // Force durable work due at recovery; only an explicitly attached module may execute it.
    host.store.createRun('alice', ''); host.store.createRun('bob', ''); host.tick()
    await vi.waitFor(() => expect(entered).toEqual(['bob']))
    expect((await space.runChat(input('alice'), () => {})).state).toBe('completed')
    await expect(space.request('get', 'alice')).rejects.toThrow(/未启用/)
    await space.attachModule('alice', 'workloop')
    await vi.waitFor(() => expect(entered).toEqual(['bob', 'alice']))
  } finally { await space.close(); await host.close(); rmSync(dir, { recursive: true, force: true }) }
})
