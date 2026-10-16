import { expect, it } from 'vitest'
import { ContactCommandQueue } from './command-queue'
function gate() { let release!: () => void; const promise = new Promise<void>(r => { release = r }); return { promise, release } }

it('keeps one contact ordered while another contact can complete', async () => {
  const queue = new ContactCommandQueue(), hold = gate(), order: string[] = []
  const slow = queue.submit('alice', false, async () => { order.push('a1'); await hold.promise })
  const next = queue.submit('alice', false, async () => { order.push('a2') })
  await queue.submit('bob', false, async () => { order.push('b') })
  expect(order).toEqual(['a1', 'b'])
  hold.release(); await Promise.all([slow, next])
  expect(order).toEqual(['a1', 'b', 'a2'])
})

it('orders shutdown across all contacts, including failed commands', async () => {
  const queue = new ContactCommandQueue(), hold = gate(), order: string[] = []
  const before = queue.submit('alice', false, async () => { await hold.promise; order.push('before'); throw new Error('failed request') }).catch(() => {})
  const sync = queue.submit('', true, async () => { order.push('close') })
  const after = queue.submit('bob', false, async () => { order.push('after') })
  await Promise.resolve(); expect(order).toEqual([])
  hold.release(); await Promise.all([before, sync, after])
  expect(order).toEqual(['before', 'close', 'after'])
})
