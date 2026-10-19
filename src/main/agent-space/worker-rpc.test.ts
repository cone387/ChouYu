import { afterEach, expect, it, vi } from 'vitest'
import { AgentWorkerRPC } from './worker-rpc'
afterEach(() => vi.useRealTimers())
function worker() { return { postMessage: vi.fn(), kill: vi.fn() } }
it('allows a cold start longer than the old 15 second deadline', async () => {
  vi.useFakeTimers(); const w = worker(), rpc = new AgentWorkerRPC()
  const pending = rpc.request(w, 'init', '', [])
  await vi.advanceTimersByTimeAsync(20000); expect(w.kill).not.toHaveBeenCalled()
  rpc.receive(w, { requestId: 1, started: true }); rpc.receive(w, { requestId: 1, result: 'ready' })
  expect(await pending).toBe('ready')
})
it('bounds a slow request without killing a responsive worker or rejecting its peer', async () => {
  vi.useFakeTimers(); const w = worker(), log = vi.fn(), rpc = new AgentWorkerRPC(log)
  const pending = rpc.request(w, 'getInteraction', 'owner', []).catch(e => e.message)
  await vi.advanceTimersByTimeAsync(20000); expect(w.kill).not.toHaveBeenCalled()
  rpc.receive(w, { requestId: 1, started: true })
  await vi.advanceTimersByTimeAsync(15000)
  expect(await pending).toContain('响应超时'); expect(w.kill).not.toHaveBeenCalled()
  const ping = w.postMessage.mock.calls.at(-1)![0].ping
  expect(typeof ping).toBe('number')
  rpc.receive(w, { pong: ping })
  const peer = rpc.request(w, 'get', 'peer', [])
  rpc.receive(w, { requestId: 3, result: 'peer is alive' })
  expect(await peer).toBe('peer is alive')
  await vi.advanceTimersByTimeAsync(5000)
  expect(w.kill).not.toHaveBeenCalled()
  expect(log).toHaveBeenCalledWith({ method: 'getInteraction', phase: 'running', elapsedMs: 35000 })
})
it('an old generation timeout cannot kill or resolve the new worker', async () => {
  vi.useFakeTimers(); const old = worker(), next = worker(), rpc = new AgentWorkerRPC()
  const first = rpc.request(old, 'init', '', []).catch(e => e.message)
  rpc.exited(old); expect(await first).toContain('已退出')
  const second = rpc.request(next, 'init', '', [])
  rpc.receive(old, { requestId: 2, result: 'wrong' })
  await vi.advanceTimersByTimeAsync(20000)
  expect(next.kill).not.toHaveBeenCalled()
  rpc.receive(next, { requestId: 2, result: 'ready' }); expect(await second).toBe('ready')
})
it('kills an unresponsive worker only after the independent health probe expires', async () => {
  vi.useFakeTimers(); const w = worker(), rpc = new AgentWorkerRPC()
  const result = rpc.request(w, 'get', '', []).catch(e => e.message)
  await vi.advanceTimersByTimeAsync(60000); expect(await result).toContain('超时'); expect(w.kill).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(5000); expect(w.kill).toHaveBeenCalledOnce()
})

it('does not accept a health reply from another generation', async () => {
  vi.useFakeTimers(); const old = worker(), next = worker(), rpc = new AgentWorkerRPC()
  const result = rpc.request(old, 'get', 'owner', []).catch(e => e.message)
  await vi.advanceTimersByTimeAsync(60000); await result
  rpc.receive(next, { pong: old.postMessage.mock.calls.at(-1)![0].ping })
  await vi.advanceTimersByTimeAsync(5000)
  expect(old.kill).toHaveBeenCalledOnce(); expect(next.kill).not.toHaveBeenCalled()
})

it('records structured storage failure phases without persisting the error message', async () => {
  const w = worker(), events: unknown[] = [], rpc = new AgentWorkerRPC(event => events.push(event))
  const pending = rpc.request(w, 'init', '', []).catch(error => error.message)
  rpc.receive(w, { requestId: 1, error: 'sensitive-path-or-provider-detail', storage: { database: 'checkpoints', phase: 'wal', code: 'SQLITE_IOERR_TRUNCATE' } } as never)
  expect(await pending).toBe('sensitive-path-or-provider-detail')
  expect(events).toContainEqual(expect.objectContaining({ method: 'init', phase: 'failed:startup', storage: { database: 'checkpoints', phase: 'wal', code: 'SQLITE_IOERR_TRUNCATE' } }))
  expect(JSON.stringify(events)).not.toContain('sensitive-path-or-provider-detail')
})
