import { expect, it, vi } from 'vitest'
import { ContactCommandQueue } from './command-queue'
import { dispatchContactCommand } from './worker-commands'

it('keeps periodic reconciliation and request identity sync from blocking another contact', async () => {
  const queue = new ContactCommandQueue(), order: string[] = []
  let release!: () => void
  const hold = new Promise<void>(resolve => { release = resolve })
  const service = {
    async sync(_identities: unknown[], enqueue: (id: string, operation: () => Promise<void>) => Promise<void>) {
      await Promise.all(['alice', 'bob'].map(id => enqueue(id, async () => { order.push(`sync:${id}`) })))
    },
    async syncContact(identity: { id: string }) { order.push(`identity:${identity.id}`) },
    async dispatchUnknown(_method: string, id: string) { order.push(`command:${id}`); if (id === 'alice') await hold },
    async close() { order.push('closed') }
  }
  const slow = dispatchContactCommand(queue, service, 'deleteTopic', 'alice', ['task', 1])
  const periodic = dispatchContactCommand(queue, service, 'sync', '', [[]])
  try {
    await dispatchContactCommand(queue, service, 'syncContact', 'bob', [{ id: 'bob' }])
    await dispatchContactCommand(queue, service, 'get', 'bob', [])
    expect(order).toEqual(['command:alice', 'sync:bob', 'identity:bob', 'command:bob'])
    const closing = dispatchContactCommand(queue, service, 'close', '', [])
    expect(order).not.toContain('closed')
    release(); await Promise.all([slow, periodic, closing])
    expect(order.at(-1)).toBe('closed')
  } finally { release() }
})

it('rejects malformed transport commands before queuing or invoking a host', async () => {
  const queue = new ContactCommandQueue()
  const service = { sync: async () => {}, syncContact: async () => {}, dispatchUnknown: async () => {}, close: async () => {} }
  await expect(dispatchContactCommand(queue, service, 'get', 'alice', {})).rejects.toThrow()
  await expect(dispatchContactCommand(queue, service, 'madeUp', 'alice', [])).rejects.toThrow()
  await expect(dispatchContactCommand(queue, service, 'syncContact', 'alice', [{ id: 'bob' }])).rejects.toThrow('不一致')
  await expect(dispatchContactCommand(queue, service, 'sync', '', [null])).rejects.toThrow()
})
it('keeps storage admission waiting in the queue phase instead of consuming execution timeout', async () => {
  let release!: () => void
  const hold = new Promise<void>(resolve => { release = resolve }), started = vi.fn()
  const service = { sync: async () => {}, syncContact: async () => {}, dispatchUnknown: async () => {}, close: async () => {},
    admitCommand: vi.fn(async (_method: string, work: () => Promise<unknown>) => { await hold; return work() }) }
  const request = dispatchContactCommand(new ContactCommandQueue(), service, 'get', 'alice', [], started)
  await vi.waitFor(() => expect(service.admitCommand).toHaveBeenCalledOnce())
  expect(started).not.toHaveBeenCalled()
  release(); await request
  expect(started).toHaveBeenCalledOnce()
})
