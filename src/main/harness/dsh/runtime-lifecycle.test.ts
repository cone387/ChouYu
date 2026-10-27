import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as childProcess from 'node:child_process'
import { DshRuntimePool, type DshRunInput } from './runtime'
import { DEFAULT_APP_CONFIG } from '../../../shared/config'
import type { DshRuntimeOptions, HarnessInput } from '../contracts'
import { HarnessCoordinator } from '../coordinator'
import { HarnessRegistry } from '../registry'
import { HarnessStore } from '../store'
import { ActionResults } from '../action-results'
import { DshAdapter } from './adapter'
import { createNativeModule } from '../native'

vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, execFile: vi.fn(actual.execFile) }
})

const cleanup: Array<() => unknown> = []
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action() })

function fixture(options: Partial<DshRuntimeOptions> = {}, remote: { acknowledgeCancel?: boolean; readyDelayMs?: number; peerTool?: boolean; descendant?: boolean; roundBefore?: boolean } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'chouyu-dsh-lifecycle-'))
  const helper = join(home, 'helper.mjs')
  // Real child + authenticated TCP, with an intentionally uncooperative remote agent.
  writeFileSync(helper, `
import { connect } from 'node:net';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { RpcPeer } from ${JSON.stringify(pathToFileURL(resolve('runtime/dsh/wire.mjs')).href)};
writeFileSync(join(${JSON.stringify(home)}, String(process.pid) + '.pid'), String(process.pid));
if (${Boolean(remote.descendant)}) {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' });
  writeFileSync(join(${JSON.stringify(home)}, String(child.pid) + '.pid'), String(child.pid));
}
let helper, plugin;
helper = new RpcPeer(connect(Number(process.env.CHOUYU_DSH_PORT), '127.0.0.1'), async method => {
  if (method === 'ready') { await new Promise(resolve => setTimeout(resolve, ${remote.readyDelayMs ?? 0})); return true; }
  if (method === 'close') { setTimeout(() => process.exit(0), 5); return true; }
});
plugin = new RpcPeer(connect(Number(process.env.CHOUYU_DSH_PORT), '127.0.0.1'), async (method, value) => {
  if (method === 'prepare') return { inputMessageId: value.attemptId };
  if (method === 'run') {
    writeFileSync(join(${JSON.stringify(home)}, value.attemptId + '.started'), 'started');
    if (${Boolean(remote.peerTool)} && value.attemptId === 'peer') void plugin.request('tool', { ...value, callId: 'held', name: 'fixture', args: {} }).catch(() => {});
    if (${Boolean(remote.roundBefore)}) void plugin.request('round:before', { ...value, round: 0, serializedInput: 'fixture' }).catch(() => {});
    return new Promise(() => {});
  }
  if (method === 'cancel') return ${remote.acknowledgeCancel ? 'true' : 'new Promise(() => {})'};
  return true;
});
await helper.request('hello', {role:'helper',token:process.env.CHOUYU_DSH_TOKEN});
await plugin.request('hello', {role:'plugin',token:process.env.CHOUYU_DSH_TOKEN});
`)
  const pool = new DshRuntimePool({ home, helper, node: process.execPath, ...options })
  const pids = () => readdirSync(home).filter(name => name.endsWith('.pid')).map(name => Number(readFileSync(join(home, name), 'utf8')))
  const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
  cleanup.push(() => rmSync(home, { recursive: true, force: true }), () => pool.close(), async () => {
    for (const pid of pids()) if (alive(pid)) process.kill(pid)
    await vi.waitFor(() => expect(pids().filter(alive)).toHaveLength(0))
  })
  const input = (id: string, version = 'one', signal = new AbortController().signal): HarnessInput => ({
    requestId: id, attemptId: id, characterId: id, sessionId: id, configVersion: version, snapshotFingerprint: id,
    messages: [{ role: 'user', content: id }], systemPrompt: 'fixture', signal, assertContext: async () => {},
    config: { ...DEFAULT_APP_CONFIG, provider: 'openai', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'fixture', model: 'fixture' }
  })
  return { pool, input, pids, alive, started: (id: string) => readdirSync(home).includes(id + '.started') }
}

it.each([false, true])('reaps a live runtime before cancelled work and its peer settle (cancel acknowledged: %s)', async acknowledgeCancel => {
  const f = fixture({ cancelTimeoutMs: 80 }, { acknowledgeCancel }), abort = new AbortController()
  const first = f.input('first', 'one', abort.signal), peer = f.input('peer')
  const a = await f.pool.acquire(first), b = await f.pool.acquire(peer)
  let done = false
  const running = Promise.allSettled([a.run(first, () => {}), b.run(peer, () => {})]).then(value => {
    expect(f.pids().filter(f.alive)).toHaveLength(0)
    done = true; return value
  })
  await vi.waitFor(() => expect(f.started('first') && f.started('peer')).toBe(true))
  // Waiting for the user/remote agent itself has no wall-clock deadline.
  await new Promise(resolve => setTimeout(resolve, 150))
  expect(done).toBe(false)
  abort.abort()
  await vi.waitFor(() => expect(done).toBe(true), { timeout: 2000 })
  expect((await running).map(value => value.status)).toEqual(['rejected', 'rejected'])
  await Promise.all([a.release(), a.release(), b.release()])
  const next = await f.pool.acquire(f.input('next'))
  expect(f.pids().filter(f.alive)).toHaveLength(1)
  await next.release()
})

it.each([
  ['context', false], ['reservation', false], ['context', true], ['reservation', true]
] as const)('drains pending round admission before releasing work and settling budget (%s, peer: %s)', async (phase, peer) => {
  const f = fixture({ cancelTimeoutMs: 80 }, { roundBefore: true }), abort = new AbortController()
  let release!: () => void, entered = false, checks = 0, reservations = 0, settled = false
  const gate = new Promise<void>(resolve => { release = resolve }), order: string[] = []
  cleanup.push(() => release())
  const input: DshRunInput = { ...f.input('a', 'one', peer ? new AbortController().signal : abort.signal),
    assertContext: async () => { if (++checks === 2 && phase === 'context') { entered = true; await gate } },
    rounds: {
      beforeRound: async () => { reservations++; entered = true; if (phase === 'reservation') await gate; order.push('reserved'); return 512 },
      afterRound: () => { order.push('settled') }
    }
  }
  const first = peer ? f.input('first', 'one', abort.signal) : undefined
  const firstLease = first ? await f.pool.acquire(first) : undefined
  const firstRun = firstLease?.run(first!, () => {}).catch(error => error)
  const lease = await f.pool.acquire(input)
  const running = lease.run(input, () => {}).catch(error => error).finally(() => { settled = true })
  await vi.waitFor(() => expect(entered).toBe(true))
  abort.abort()
  await vi.waitFor(() => expect(f.pids().filter(f.alive)).toHaveLength(0), { timeout: 2000 })
  expect(settled).toBe(false)
  expect(order).toEqual([])
  release()
  await running; await lease.release(); await firstRun; await firstLease?.release()
  expect(reservations).toBe(phase === 'context' ? 0 : 1)
  expect(order).toEqual(phase === 'context' ? [] : ['reserved', 'settled'])
})

it('does not start a peer host tool after its pending context check outlives the runtime', async () => {
  const f = fixture({ cancelTimeoutMs: 80 }, { peerTool: true }), abort = new AbortController()
  let release!: () => void, entered = false, checks = 0, executions = 0, settled = false
  const gate = new Promise<void>(resolve => { release = resolve })
  cleanup.push(() => release())
  const first = f.input('first', 'one', abort.signal), peer = f.input('peer')
  peer.assertContext = async () => { if (++checks === 2) { entered = true; await gate } }
  peer.tools = { definitions: [{ name: 'fixture', displayName: 'fixture', description: 'fixture', source: 'builtin', risk: 'safe', requiresConfirmation: false, inputSchema: { type: 'object', properties: {} } }],
    execute: async () => { executions++; return 'unexpected' } }
  const a = await f.pool.acquire(first), b = await f.pool.acquire(peer)
  const firstRun = a.run(first, () => {}).catch(error => error)
  const peerRun = b.run(peer, () => {}).catch(error => error).finally(() => { settled = true })
  await vi.waitFor(() => expect(entered).toBe(true))
  abort.abort()
  await vi.waitFor(() => expect(f.pids().filter(f.alive)).toHaveLength(0), { timeout: 2000 })
  expect(settled).toBe(false)
  release()
  await Promise.all([firstRun, peerRun]); await Promise.all([a.release(), b.release()])
  expect(executions).toBe(0)
})

it('protects active leases at capacity and evicts released groups before starting replacements', async () => {
  const f = fixture({ maxRuntimeGroups: 2, idleTimeoutMs: 10000 })
  const aInput = f.input('a'), a = await f.pool.acquire(aInput)
  const firstPid = f.pids()[0]
  const b = await f.pool.acquire(f.input('b', 'two'))
  await expect(f.pool.acquire(f.input('full', 'three'))).rejects.toThrow(/上限|容量/)
  const secondPid = f.pids().find(pid => pid !== firstPid)!
  await Promise.all([a.release(), a.release()])
  for (let n = 0; n < 5; n++) {
    const next = await f.pool.acquire(f.input('next' + n, 'new' + n))
    expect(f.pids().filter(f.alive)).toHaveLength(2)
    await next.release()
  }
  expect(f.alive(secondPid)).toBe(true)
  await b.release()
  await Promise.all([f.pool.close(), f.pool.close()])
  expect(f.pids().filter(f.alive)).toHaveLength(0)
  await expect(f.pool.acquire(f.input('closed'))).rejects.toThrow(/关闭/)
})

it('serializes capacity admission while sharing leases for the same configuration', async () => {
  const f = fixture({ maxRuntimeGroups: 1, idleTimeoutMs: 80 })
  const [a, b, full] = await Promise.allSettled([
    f.pool.acquire(f.input('a')), f.pool.acquire(f.input('b')), f.pool.acquire(f.input('full', 'two'))
  ])
  expect([a.status, b.status, full.status]).toEqual(['fulfilled', 'fulfilled', 'rejected'])
  if (a.status !== 'fulfilled' || b.status !== 'fulfilled') throw new Error('missing lease')
  expect(f.pids()).toHaveLength(1)
  await a.value.release()
  await new Promise(resolve => setTimeout(resolve, 150))
  expect(f.pids().filter(f.alive)).toHaveLength(1)
  await expect(a.value.run(f.input('a'), () => {})).rejects.toThrow(/释放/)
  await b.value.release()
  await vi.waitFor(() => expect(f.pids().filter(f.alive)).toHaveLength(0), { timeout: 1500 })
})

it('keeps an early release leased until its remote execution really exits', async () => {
  const f = fixture({ maxRuntimeGroups: 1, idleTimeoutMs: 80, cancelTimeoutMs: 80 }), abort = new AbortController()
  const input = f.input('a', 'one', abort.signal), lease = await f.pool.acquire(input)
  const running = lease.run(input, () => {}).catch(error => error)
  await vi.waitFor(() => expect(f.started('a')).toBe(true))
  let released = false
  const release = Promise.resolve(lease.release()).then(() => { released = true })
  await new Promise(resolve => setTimeout(resolve, 150))
  expect(released).toBe(false)
  await expect(f.pool.acquire(f.input('b', 'two'))).rejects.toThrow(/容量/)
  abort.abort()
  await release; await running
  expect(f.pids().filter(f.alive)).toHaveLength(0)
})

it('keeps a faulted peer occupied until its already-running host tool exits', async () => {
  const f = fixture({ cancelTimeoutMs: 80 }, { peerTool: true }), abort = new AbortController()
  let release!: () => void, toolStarted = false, peerSettled = false
  const held = new Promise<void>(resolve => { release = resolve })
  cleanup.push(() => release())
  const first = f.input('first', 'one', abort.signal), peer = f.input('peer')
  peer.tools = { definitions: [{ name: 'fixture', displayName: 'fixture', description: 'fixture', source: 'builtin', risk: 'safe', requiresConfirmation: false, inputSchema: { type: 'object', properties: {} } }],
    execute: async () => { toolStarted = true; await held; return 'finished' } }
  const a = await f.pool.acquire(first), b = await f.pool.acquire(peer)
  const firstRun = a.run(first, () => {}).catch(error => error)
  const peerRun = b.run(peer, () => {}).catch(error => error).finally(() => { peerSettled = true })
  await vi.waitFor(() => expect(toolStarted).toBe(true))
  abort.abort()
  await vi.waitFor(() => expect(f.pids().filter(f.alive)).toHaveLength(0), { timeout: 2000 })
  expect(peerSettled).toBe(false)
  release()
  await Promise.all([firstRun, peerRun]); await Promise.all([a.release(), b.release()])
})

it('cancels and drains the original peer confirmation on shared runtime failure, reporting failure', async () => {
  const f = fixture({ cancelTimeoutMs: 80 }, { peerTool: true }), abort = new AbortController(), emergency = new AbortController()
  const store = new HarnessStore(':memory:')
  let reading = false, obsolete = false, peerSettled = false
  const actions = new ActionResults(store, {
    read: async () => { reading = true; return { kind: 'action', id: 'card', version: '1', characterId: 'peer', status: obsolete ? 'obsolete' : 'pending', request: { sessionId: 'peer' } } as never },
    subscribe: () => () => {}, cancel: async () => { await new Promise(resolve => setTimeout(resolve, 20)); obsolete = true }
  })
  const coordinator = new HarnessCoordinator(new HarnessRegistry([{ ...createNativeModule(), id: 'dsh', adapter: new DshAdapter(f.pool, store) }]))
  cleanup.push(() => store.close(), () => coordinator.close(), () => emergency.abort())
  const first = f.input('first', 'one', abort.signal), peer = f.input('peer')
  peer.bindTools = bound => ({ definitions: [{ name: 'fixture', displayName: 'fixture', description: 'fixture', source: 'builtin', risk: 'write', requiresConfirmation: true, inputSchema: { type: 'object', properties: {} } }],
    execute: call => actions.waitForActionReceipt({ ...bound, callId: call.id }, 'card', AbortSignal.any([bound.signal, emergency.signal])) })
  const firstRun = coordinator.run(first, () => {}, 'dsh')
  const peerRun = coordinator.run(peer, () => {}, 'dsh').then(value => { peerSettled = true; return value })
  await vi.waitFor(() => expect(reading).toBe(true))
  await new Promise(resolve => setTimeout(resolve, 150))
  expect(peerSettled).toBe(false); expect(obsolete).toBe(false)
  abort.abort()
  await vi.waitFor(() => expect(peerSettled).toBe(true), { timeout: 2500 })
  expect(await peerRun).toMatchObject({ state: 'failed' })
  expect(await firstRun).toMatchObject({ state: 'cancelled' })
  expect(obsolete).toBe(true); expect(peer.signal.aborted).toBe(false)
})

it.skipIf(process.platform !== 'win32')('retries failed process termination without releasing live work', async () => {
  const f = fixture({ cancelTimeoutMs: 80 }), abort = new AbortController()
  const input = f.input('a', 'one', abort.signal), lease = await f.pool.acquire(input)
  let settled = false, denied = false
  const running = lease.run(input, () => {}).catch(error => error).finally(() => { settled = true })
  await vi.waitFor(() => expect(f.started('a')).toBe(true))
  const kill = vi.mocked(childProcess.execFile).mockImplementationOnce(((...args: any[]) => {
    denied = true
    queueMicrotask(() => args.at(-1)(new Error('fixture termination denied')))
    return {} as childProcess.ChildProcess
  }) as typeof childProcess.execFile)
  cleanup.push(() => kill.mockRestore())
  abort.abort()
  await vi.waitFor(() => expect(denied).toBe(true))
  expect(f.pids().filter(f.alive)).toHaveLength(1)
  expect(settled).toBe(false)
  await vi.waitFor(() => expect(settled).toBe(true), { timeout: 3000 })
  await running; await lease.release()
  expect(f.pids().filter(f.alive)).toHaveLength(0)
})

it.skipIf(process.platform !== 'win32')('waits for the entire helper process tree before releasing a faulted request', async () => {
  const f = fixture({ cancelTimeoutMs: 80 }, { descendant: true }), abort = new AbortController()
  const input = f.input('a', 'one', abort.signal), lease = await f.pool.acquire(input)
  const running = lease.run(input, () => {}).catch(error => error)
  await vi.waitFor(() => expect(f.started('a')).toBe(true))
  expect(f.pids().filter(f.alive)).toHaveLength(2)
  abort.abort()
  await running; await lease.release()
  expect(f.pids().filter(f.alive)).toHaveLength(0)
})

it('reclaims startup work after its only acquiring caller cancels', async () => {
  const f = fixture({ idleTimeoutMs: 80 }, { readyDelayMs: 200 }), abort = new AbortController()
  const pending = f.pool.acquire(f.input('a', 'one', abort.signal)).catch(error => error)
  await vi.waitFor(() => expect(f.pids()).toHaveLength(1))
  abort.abort(new Error('cancelled startup'))
  expect(await pending).toMatchObject({ message: 'cancelled startup' })
  await vi.waitFor(() => expect(f.pids().filter(f.alive)).toHaveLength(0), { timeout: 1500 })
})

it('reclaims idle runtimes but leaves a leased runtime alive until it is released', async () => {
  const f = fixture({ idleTimeoutMs: 80 })
  const a = await f.pool.acquire(f.input('a')), b = await f.pool.acquire(f.input('b', 'two'))
  await a.release()
  await vi.waitFor(() => expect(f.pids().filter(f.alive)).toHaveLength(1), { timeout: 1500 })
  await b.release()
  await vi.waitFor(() => expect(f.pids().filter(f.alive)).toHaveLength(0), { timeout: 1500 })
})
