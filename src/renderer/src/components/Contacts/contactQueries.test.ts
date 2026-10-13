import { afterEach, expect, it, vi } from 'vitest'
import { ContactQueries } from './contactQueries'

afterEach(() => vi.useRealTimers())
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r }); return { promise, resolve } }
it('shares matching inflight reads and keeps owners and arguments isolated', async () => {
  const queries = new ContactQueries(), pending = deferred<number>(), load = vi.fn(() => pending.promise)
  const first = queries.read('a', 'delivery', [1], load), second = queries.read('a', 'delivery', [1], load)
  expect(load).toHaveBeenCalledTimes(1)
  expect(await queries.read('b', 'delivery', [1], async () => 9)).toBe(9)
  expect(await queries.read('a', 'delivery', [2], async () => 8)).toBe(8)
  pending.resolve(1); expect(await Promise.all([first, second])).toEqual([1, 1])
})
it('never returns a response from before an invalidation; merges followup reads', async () => {
  const queries = new ContactQueries(), old = deferred<number>(), fresh = deferred<number>()
  const load = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
  const first = queries.read('a', 'get', [], load)
  queries.invalidate('a')
  const second = queries.read('a', 'get', [], load)
  old.resolve(1); await Promise.resolve(); await Promise.resolve()
  expect(load).toHaveBeenCalledTimes(2)
  fresh.resolve(2); expect(await Promise.all([first, second])).toEqual([2, 2])
})
it('failures are retryable and settled reads are not cached across page returns', async () => {
  const queries = new ContactQueries(), load = vi.fn().mockRejectedValueOnce(Error('restart')).mockResolvedValueOnce(2).mockResolvedValueOnce(3)
  await expect(queries.read('a', 'get', [], load)).rejects.toThrow('restart')
  expect(await queries.read('a', 'get', [], load)).toBe(2)
  expect(await queries.read('a', 'get', [], load)).toBe(3)
})
it('coalesces events, stops polling with no visible subscribers and refreshes on return', async () => {
  vi.useFakeTimers()
  let changed!: (id: string) => void
  const unsubscribe = vi.fn(), subscribe = vi.fn(listener => { changed = listener; return unsubscribe })
  const queries = new ContactQueries(subscribe), refresh = vi.fn()
  const stop = queries.watch('a', refresh, 5000)
  expect(refresh).toHaveBeenCalledTimes(1)
  changed('a'); changed('a'); changed('a'); await vi.advanceTimersByTimeAsync(150)
  expect(refresh).toHaveBeenCalledTimes(2)
  stop(); await vi.advanceTimersByTimeAsync(15000)
  expect(refresh).toHaveBeenCalledTimes(2); expect(unsubscribe).toHaveBeenCalledOnce()
  const back = queries.watch('a', refresh, 5000)
  expect(refresh).toHaveBeenCalledTimes(3); back()
})
it('one owner subscription serves multiple visible consumers and no late callback fires after removal', async () => {
  vi.useFakeTimers()
  let changed!: (id: string) => void
  const subscribe = vi.fn(listener => { changed = listener; return () => {} })
  const queries = new ContactQueries(subscribe), first = vi.fn(), second = vi.fn()
  const stopFirst = queries.watch('a', first, 5000), stopSecond = queries.watch('a', second, 5000)
  expect(subscribe).toHaveBeenCalledTimes(1)
  changed('a'); stopFirst(); await vi.advanceTimersByTimeAsync(150)
  expect(first).toHaveBeenCalledTimes(1); expect(second).toHaveBeenCalledTimes(2)
  stopSecond()
})
