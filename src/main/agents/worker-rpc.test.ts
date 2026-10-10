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
it('does not count queue waiting against execution time, but still bounds a hung operation', async () => {
  vi.useFakeTimers(); const w = worker(), log = vi.fn(), rpc = new AgentWorkerRPC(log)
  const pending = rpc.request(w, 'getInteraction', 'owner', []).catch(e => e.message)
  await vi.advanceTimersByTimeAsync(20000); expect(w.kill).not.toHaveBeenCalled()
  rpc.receive(w, { requestId: 1, started: true })
  await vi.advanceTimersByTimeAsync(15000)
  expect(await pending).toContain('响应超时'); expect(w.kill).toHaveBeenCalledOnce()
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
it('bounds requests that never leave the queue', async () => {
  vi.useFakeTimers(); const w = worker(), rpc = new AgentWorkerRPC()
  const result = rpc.request(w, 'get', '', []).catch(e => e.message)
  await vi.advanceTimersByTimeAsync(60000); expect(await result).toContain('超时'); expect(w.kill).toHaveBeenCalledOnce()
})
