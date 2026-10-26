import { expect, it, vi } from 'vitest'
import { ContactStorageBarrier } from './storage-barrier'

function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
it('blocks new commands until all admitted work has reached a safe boundary', async () => {
  const barrier = new ContactStorageBarrier(), model = deferred(), copying = deferred(), events: string[] = []
  const run = barrier.operation(async lease => {
    lease.onDrain(() => events.push('drain'))
    await model.promise; events.push('saved')
    await lease.boundary(); events.push('next')
  })
  const snapshot = barrier.snapshot(async () => { events.push('backup'); await copying.promise })
  const command = barrier.operation(() => { events.push('command') })
  expect(events).toEqual(['drain'])
  model.resolve()
  await vi.waitFor(() => expect(events).toEqual(['drain', 'saved', 'backup']))
  copying.resolve(); await Promise.all([run, snapshot, command])
  expect(events.slice(3).sort()).toEqual(['command', 'next'])
})
it('times out after 30 seconds without cancelling or dropping the late result', async () => {
  vi.useFakeTimers()
  try {
    const barrier = new ContactStorageBarrier(), hold = deferred(), saved = vi.fn(), copy = vi.fn()
    const run = barrier.operation(async () => { await hold.promise; saved() })
    const snapshot = expect(barrier.snapshot(copy)).rejects.toThrow(/安全边界/)
    await vi.advanceTimersByTimeAsync(30000); await snapshot
    await barrier.operation(() => {})
    hold.resolve(); await run
    expect(copy).not.toHaveBeenCalled(); expect(saved).toHaveBeenCalledOnce()
    expect(barrier.blocked).toBe(false)
  } finally { vi.useRealTimers() }
})
it('admits nested tool commands while draining their already admitted step', async () => {
  const barrier = new ContactStorageBarrier(), hold = deferred(), events: string[] = []
  const work = barrier.operation(async () => { await hold.promise; await barrier.operation(() => { events.push('tool') }) })
  const copy = barrier.snapshot(() => { events.push('backup') })
  hold.resolve(); await Promise.all([work, copy])
  expect(events).toEqual(['tool', 'backup'])
})
it('rechecks newly admitted completion work before entering the exclusive window', async () => {
  const barrier = new ContactStorageBarrier(), first = deferred(), late = deferred(), entered = deferred(), copied = vi.fn()
  const original = barrier.operation(async () => { await first.promise })
  const copy = barrier.snapshot(copied)
  first.resolve()
  const completion = original.then(() => barrier.controlOperation(async () => { entered.resolve(); await late.promise }))
  await entered.promise
  expect(copied).not.toHaveBeenCalled()
  late.resolve(); await Promise.all([completion, copy])
  expect(copied).toHaveBeenCalledOnce()
})
it('holds cancellation writes while files are actually being copied', async () => {
  const barrier = new ContactStorageBarrier(), hold = deferred(), called = vi.fn()
  const copy = barrier.snapshot(() => hold.promise)
  const cancel = barrier.controlOperation(called)
  expect(called).not.toHaveBeenCalled()
  hold.resolve(); await Promise.all([copy, cancel]); expect(called).toHaveBeenCalledOnce()
})
