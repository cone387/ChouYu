import { expect, it } from 'vitest'
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
    syncContact(identity: { id: string }) { order.push(`identity:${identity.id}`) },
    async request(_method: string, id: string) { order.push(`command:${id}`); if (id === 'alice') await hold },
    async close() { order.push('closed') }
  }
  const slow = dispatchContactCommand(queue, service, 'deleteTopic', 'alice', [])
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
