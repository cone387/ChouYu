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
it('automatically creates the first group, coalesces clean snapshots and saves final dirty work', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'chouyu-host-backups-'))
  const host = new WorkLoopHost(dir, () => {})
  try {
    await host.sync([{ id: 'alice', soul: '', conversation: '', config, workLoopEnabled: false }])
    expect(host.backups.list()).toHaveLength(0)
    await host.request('assignTopic', 'alice', ['Read a book'])
    await vi.waitFor(() => expect(host.backups.list()).toHaveLength(1))
    await host.backupNow()
    const first = host.backups.list()[0].id
    await host.backupNow()
    expect(host.backups.list()[0].id).toBe(first)
    host.store.db.prepare("UPDATE profiles SET next_at=123 WHERE character_id='alice'").run()
    await host.close()
    expect(host.backups.list()[0].id).not.toBe(first)
  } finally { await host.close(); rmSync(dir, { recursive: true, force: true }) }
})
it('observes persisted pending notices and action cards without acknowledging them', async () => {
  const { space } = await fixture(2)
  space.store.db.prepare('INSERT INTO notices(id,character_id,value,state) VALUES(?,?,?,?)').run('pending', 'alice', JSON.stringify({ createdAt: 100 }), 'pending')
  space.store.db.prepare('INSERT INTO notices(id,character_id,value,state) VALUES(?,?,?,?)').run('sent', 'alice', JSON.stringify({ createdAt: 50 }), 'sent')
  space.store.db.prepare('INSERT INTO contact_interactions(id,character_id,value) VALUES(?,?,?)').run('card', 'bob', JSON.stringify({ kind: 'action', delivered: false, createdAt: 200 }))
  const result = await space.request('spaceDiagnostics', '')
  expect(result.metrics).toMatchObject({ pendingDeliveries: 2, oldestPendingAt: 100, activeRuns: 0, capacity: 2 })
  expect(space.store.db.prepare("SELECT state FROM notices WHERE id='pending'").get()).toEqual({ state: 'pending' })
})
it('applies only changed identities while reconciling removed owners', async () => {
  const { space } = await fixture(2)
  const sync = vi.spyOn(space, 'syncContact')
  await space.syncChanged(['alice', 'bob'], [])
  expect(sync).not.toHaveBeenCalled()
  await space.syncChanged(['alice', 'bob'], [{ ...identities[0], conversation: 'new message' }])
  expect(sync).toHaveBeenCalledTimes(1)
  await space.syncChanged(['bob'], [])
  expect(space.store.profile('alice')).toBeUndefined()
  expect(space.store.profile('bob')).toBeDefined()
})
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
