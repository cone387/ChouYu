import { expect, it } from 'vitest'
import { ContactAgent } from './agent'
import { ModuleRegistry } from './registry'
import { ContactEvents } from '../agent-space/events'

it('mounts modules independently and closes exactly once without destroying the contact identity', async () => {
  const calls: string[] = [], registry = new ModuleRegistry()
  registry.register('workloop', owner => ({ id: 'workloop', advance: () => { calls.push(owner.id); return false }, close: async () => { calls.push('closed:' + owner.id) } }))
  const a = new ContactAgent({ id: 'alice', soul: '', conversation: '', config: null }, registry)
  const b = new ContactAgent({ id: 'bob', soul: '', conversation: '', config: null }, registry)
  a.mount(['workloop']); b.mount([])
  a.advance(); b.advance()
  expect(calls).toEqual(['alice'])
  await Promise.all([a.close(), a.close()])
  a.advance()
  expect(calls).toEqual(['alice', 'closed:alice'])
  expect(a.identity.id).toBe('alice')
})

it('rejects unknown or duplicated module requests before mounting any module', () => {
  const registry = new ModuleRegistry(), calls: string[] = []
  registry.register('workloop', () => { calls.push('created'); return { id: 'workloop', close: async () => {} } })
  expect(() => registry.register('workloop', () => { throw new Error() })).toThrow()
  const agent = new ContactAgent({ id: 'alice', soul: '', conversation: '', config: null }, registry)
  expect(() => agent.mount(['workloop', 'unknown'])).toThrow()
  expect(() => agent.mount(['workloop', 'workloop'])).toThrow()
  expect(calls).toEqual([])
})

it('routes events only to the requested contact and removes subscriptions on disposal', () => {
  const events = new ContactEvents(), received: string[] = []
  const dispose = events.subscribe('alice', () => received.push('alice'))
  events.subscribe('bob', () => received.push('bob'))
  events.publish('alice'); dispose(); events.publish('alice'); events.publish('bob')
  expect(received).toEqual(['alice', 'bob'])
})
