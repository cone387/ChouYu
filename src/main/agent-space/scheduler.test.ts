import { expect, it } from 'vitest'
import { RunScheduler } from './scheduler'

const key = (id: string, characterId = 'alice', topicId = id) => ({ id, characterId, topicId })
function gate() { let release!: () => void; const promise = new Promise<void>(r => { release = r }); return { promise, release } }

it('keeps cancelled work in its slot until it actually exits, including the same task replacement', async () => {
  const scheduler = new RunScheduler(2), first = gate(), second = gate()
  let signal!: AbortSignal
  expect(scheduler.launch(key('old', 'alice', 'task'), 2, async s => { signal = s; await first.promise })).toBe(true)
  await Promise.resolve()
  scheduler.abort('alice', 'task')
  expect(signal.aborted).toBe(true)
  expect(scheduler.launch(key('new', 'alice', 'task'), 2, async () => {})).toBe(false)
  expect(scheduler.launch(key('peer', 'bob'), 1, () => second.promise)).toBe(true)
  expect(scheduler.launch(key('overflow', 'carol'), 1, async () => {})).toBe(false)
  first.release(); await scheduler.drain('alice')
  expect(scheduler.launch(key('new', 'alice', 'task'), 1, async () => {})).toBe(true)
  second.release(); await scheduler.drain()
  expect(scheduler.activeFor('alice')).toHaveLength(0)
})

it('enforces contact capacity separately and releases a rejected execution', async () => {
  const failures: unknown[] = [], scheduler = new RunScheduler(4, error => failures.push(error)), hold = gate()
  scheduler.launch(key('one'), 1, () => hold.promise)
  expect(scheduler.launch(key('two'), 1, async () => {})).toBe(false)
  scheduler.launch(key('other', 'bob'), 1, async () => { throw new Error('failure') })
  await scheduler.drain('bob')
  expect(failures).toHaveLength(1)
  expect(scheduler.activeFor('alice')).toHaveLength(1)
  hold.release(); await scheduler.drain()
})

it('rejects invalid capacities before accepting work', () => {
  for (const limit of [0, -1, 1.5, NaN, Infinity]) expect(() => new RunScheduler(limit)).toThrow()
})
