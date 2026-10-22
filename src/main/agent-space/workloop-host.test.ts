import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WorkLoopHost } from './workloop-host'
import { DEFAULT_AGENT_SETTINGS } from '../../shared/agents'
import { evidenceFromText } from '../agents/sources'
import { ContactCommandQueue } from './command-queue'
import { dispatchContactCommand } from './worker-commands'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn() })
const config = { provider: 'openai' as const, baseUrl: 'https://example.com', apiKey: 'test', model: 'test', thinkingDisabledModels: [] }
const identities = ['alice', 'bob'].map(id => ({ id, soul: id, conversation: '', config }))
const report = JSON.stringify({ title: 'Saved', body: 'Evidence [1].', nextStep: 'Continue', memories: [], question: '', progress: { judgement: 'Saved', openQuestions: '', nextStep: 'Continue', reason: 'Evidence [1].', status: 'researching' } })
async function fixture(capacity: number) {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-space-'))
  const pending: { owner: string; signal: AbortSignal; resolve: (text: string) => void }[] = []
  const space = new WorkLoopHost(dir, () => {}, identity => async (_prompt, signal) => new Promise<string>((resolve, reject) => {
    signal.throwIfAborted(); pending.push({ owner: identity.id, signal, resolve })
    signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
  }), async () => evidenceFromText('https://example.com/', 'Evidence. '.repeat(100)), undefined, undefined, undefined, { capacity })
  cleanup.push(async () => { await space.close(); rmSync(dir, { recursive: true, force: true }) })
  await space.sync(identities)
  for (const identity of identities) await space.request('save', identity.id, [{ ...DEFAULT_AGENT_SETTINGS, goal: 'Research', sources: ['https://example.com/'], permissionLevel: 'sources', dailyCalls: 100 }])
  return { space, pending }
}

it('shares global capacity across contacts and gives a waiting peer the next slot', async () => {
  const { space, pending } = await fixture(1)
  await space.request('run', 'alice'); await space.request('run', 'bob')
  await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0))
  expect(pending.map(p => p.owner)).toEqual(['alice'])
  pending[0].resolve(report)
  await vi.waitFor(() => expect(pending.map(p => p.owner)).toEqual(['alice', 'bob']))
})

it('detaches only one contact workloop and keeps its tasks while the peer finishes', async () => {
  const { space, pending } = await fixture(2)
  await space.request('run', 'alice'); await space.request('run', 'bob')
  await vi.waitFor(() => expect(pending).toHaveLength(2))
  const aliceTask = space.store.overview('alice').topics[0].id
  await space.detachModule('alice', 'workloop')
  expect(pending.find(p => p.owner === 'alice')!.signal.aborted).toBe(true)
  expect(pending.find(p => p.owner === 'bob')!.signal.aborted).toBe(false)
  expect(space.store.topics.get('alice', aliceTask).id).toBe(aliceTask)
  pending.find(p => p.owner === 'bob')!.resolve(report)
  await vi.waitFor(() => expect(space.store.overview('bob').reports).toHaveLength(1))
  space.tick(); await space.sync(identities)
  expect(pending.filter(p => p.owner === 'alice')).toHaveLength(1)
})

it('rejects work after shutdown and makes repeated close safe', async () => {
  const { space } = await fixture(1)
  await Promise.all([space.close(), space.close()])
  await expect(space.sync(identities)).rejects.toThrow(/关闭/)
  await expect(space.request('get', 'alice')).rejects.toThrow(/关闭/)
})

it('reconciles a removed contact whose first identity update is still queued', async () => {
  const { space } = await fixture(1)
  const queue = new ContactCommandQueue()
  const newIdentity = { ...identities[0], id: 'charlie' }
  const adding = dispatchContactCommand(queue, space, 'syncContact', 'charlie', [newIdentity])
  const removing = dispatchContactCommand(queue, space, 'sync', '', [identities])
  await Promise.all([adding, removing])
  expect(space.store.profile('charlie')).toBeUndefined()
})

it('reads a peer while roster reconciliation waits for a removed contact to drain', async () => {
  const { space } = await fixture(1), queue = new ContactCommandQueue()
  let release!: () => void
  const hold = new Promise<void>(resolve => { release = resolve })
  const remove = space.remove.bind(space)
  vi.spyOn(space, 'remove').mockImplementation(async id => { await hold; await remove(id) })
  const removing = dispatchContactCommand(queue, space, 'sync', '', [[identities[1]]])
  try {
    await dispatchContactCommand(queue, space, 'syncContact', 'bob', [identities[1]])
    const overview = await dispatchContactCommand(queue, space, 'get', 'bob', [])
    expect((overview as import('../../shared/agents').AgentOverview).settings.goal).toBe('Research')
  } finally { release(); await removing }
  expect(space.store.profile('alice')).toBeUndefined()
})
