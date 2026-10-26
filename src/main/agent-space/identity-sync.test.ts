import { expect, it, vi } from 'vitest'
import { ContactIdentitySync } from './identity-sync'
const identity = (id: string) => ({ id, soul: '', conversation: 'real conversation', config: null })
it('avoids rereading unchanged identities and only acknowledges the captured revision', () => {
  const versions = { alice: 1, bob: 1 }, read = vi.fn(identity)
  const sync = new ContactIdentitySync(id => String(versions[id as keyof typeof versions]), read)
  sync.generation(1)
  const first = sync.capture(['alice', 'bob'])
  expect(first.items).toHaveLength(2)
  versions.alice++
  sync.confirm(first)
  expect(sync.capture(['alice', 'bob']).items.map(item => item.identity.id)).toEqual(['alice'])
  expect(read).toHaveBeenCalledTimes(3)
  const second = sync.capture(['alice', 'bob']); sync.confirm(second)
  for (let i = 0; i < 10; i++) expect(sync.capture(['alice', 'bob']).items).toEqual([])
  expect(read).toHaveBeenCalledTimes(3)
})
it('keeps failed sends dirty, removes deleted owners and resets acknowledgements on worker replacement', () => {
  const read = vi.fn(identity), sync = new ContactIdentitySync(() => '1', read)
  sync.generation(1)
  const failed = sync.capture(['alice', 'bob'])
  expect(sync.capture(['alice', 'bob']).items).toHaveLength(2)
  sync.confirm(failed)
  const removed = sync.capture(['bob'])
  expect(removed.rosterChanged).toBe(true); sync.confirm(removed)
  sync.generation(2)
  sync.confirm(failed)
  expect(sync.capture(['bob']).items.map(item => item.identity.id)).toEqual(['bob'])
  expect(read).toHaveBeenCalledTimes(2)
})
it('does not allow a caller to mutate the cached permission snapshot', () => {
  const sync = new ContactIdentitySync(() => '1', identity)
  const before = sync.read('alice'); before.soul = 'wrong role'
  expect(sync.read('alice').soul).toBe('')
})
