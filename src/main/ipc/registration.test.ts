import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import { registerDomain, type IpcRegistrar } from './registration'

function transport() {
  const events = new EventEmitter()
  const handlers = new Map<string, (...args: any[]) => any>()
  return Object.assign(events, {
    handle(name: string, callback: (...args: any[]) => any) {
      if (handlers.has(name)) throw new Error('duplicate')
      handlers.set(name, callback)
    },
    removeHandler(name: string) { handlers.delete(name) }, handlers
  })
}

it('unregisters only the listeners owned by a domain and can register again', () => {
  const bus = transport(), peer = vi.fn(), own = vi.fn()
  bus.on('event', peer)
  const setup = (ipc: IpcRegistrar) => { ipc.handle('query', () => 42); ipc.on('event', own) }
  const dispose = registerDomain(bus, setup)
  expect(bus.handlers.get('query')!()).toBe(42)
  bus.emit('event'); expect(own).toHaveBeenCalledTimes(1)
  dispose(); dispose()
  bus.emit('event')
  expect(own).toHaveBeenCalledTimes(1)
  expect(peer).toHaveBeenCalledTimes(2)
  expect(bus.handlers.size).toBe(0)
  const next = registerDomain(bus, setup)
  expect(bus.listenerCount('event')).toBe(2)
  next()
})

it('rolls back partial registration without removing another domain handler', () => {
  const bus = transport(), old = () => 'old'
  const release = vi.fn()
  bus.handle('occupied', old)
  expect(() => registerDomain(bus, ipc => {
    ipc.cleanup(release)
    ipc.handle('fresh', () => 1)
    ipc.on('event', () => {})
    ipc.handle('occupied', () => 2)
  })).toThrow('duplicate')
  expect(bus.handlers.size).toBe(1)
  expect(bus.handlers.get('occupied')).toBe(old)
  expect(bus.listenerCount('event')).toBe(0)
  expect(release).toHaveBeenCalledOnce()
})
