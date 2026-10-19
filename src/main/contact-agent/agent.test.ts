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

it('settles every module close even if one close throws synchronously', async () => {
  const registry = new ModuleRegistry(), closed: string[] = []
  registry.register('broken', () => ({ id: 'broken', close: () => { throw new Error('broken close') } }))
  registry.register('workloop', () => ({ id: 'workloop', close: async () => { closed.push('workloop') } }))
  const agent = new ContactAgent({ id: 'alice', soul: '', conversation: '', config: null }, registry)
  agent.mount(['broken', 'workloop'])
  await expect(agent.close()).rejects.toThrow('broken close')
  expect(closed).toEqual(['workloop'])
})

it('retains a draining module until detach finishes and close waits for it', async () => {
  let release!: () => void
  const hold = new Promise<void>(resolve => { release = resolve })
  const registry = new ModuleRegistry()
  registry.register('chat', () => ({ id: 'chat', close: () => hold }))
  const agent = new ContactAgent({ id: 'alice', soul: '', conversation: '', config: null }, registry)
  agent.mount(['chat'])
  const detached = agent.detach('chat')
  expect(agent.module('chat')).toBeUndefined()
  expect(() => agent.mount(['chat'])).toThrow(/卸载/)
  let closed = false
  const closing = agent.close().then(() => { closed = true })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(closed).toBe(false)
  release(); await Promise.all([closing, detached])
})

it('remounts only a detached capability while preserving its peer', async () => {
  const registry = new ModuleRegistry(), calls: string[] = []
  for (const id of ['chat', 'workloop']) registry.register(id, () => ({ id, close: async () => { calls.push(id) } }))
  const agent = new ContactAgent({ id: 'alice', soul: '', conversation: '', config: null }, registry)
  agent.mount(['chat', 'workloop'])
  const work = agent.module('workloop')
  await agent.detach('chat')
  agent.mount(['chat'])
  expect(agent.module('workloop')).toBe(work)
  expect(agent.module('chat')).toBeDefined()
  expect(() => agent.mount(['chat'])).toThrow(/装配/)
  await agent.close()
  expect(calls.filter(id => id === 'chat')).toHaveLength(2)
})

it('keeps a failed detach unavailable until a successful retry', async () => {
  let fail = true
  const registry = new ModuleRegistry()
  registry.register('workloop', () => ({ id: 'workloop', close: async () => { if (fail) throw new Error('transport lost') } }))
  const agent = new ContactAgent({ id: 'alice', soul: '', conversation: '', config: null }, registry)
  agent.mount(['workloop'])
  await expect(agent.detach('workloop')).rejects.toThrow('transport lost')
  expect(agent.module('workloop')).toBeUndefined()
  expect(() => agent.mount(['workloop'])).toThrow(/卸载/)
  fail = false
  await agent.detach('workloop')
  agent.mount(['workloop'])
  await agent.close()
})
