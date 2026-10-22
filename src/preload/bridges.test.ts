import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import type { IpcRenderer } from 'electron'
import { createSessionsBridge } from './bridges/sessions'
import { createTasksBridge } from './bridges/tasks'
import { createChatBridge } from './bridges/chat'

function transport() {
  const events = new EventEmitter()
  return Object.assign(events, { invoke: vi.fn().mockResolvedValue({ ok: true }), send: vi.fn() }) as unknown as IpcRenderer
}

it('retains an early open-panel event and detaches only the subscriber', () => {
  const ipc = transport(), bridge = createSessionsBridge(ipc)
  ipc.emit('open-chat-panel')
  const open = vi.fn()
  const off = bridge.onOpenChatPanel(open)
  expect(open).toHaveBeenCalledTimes(1)
  ipc.emit('open-chat-panel'); expect(open).toHaveBeenCalledTimes(2)
  off(); ipc.emit('open-chat-panel'); expect(open).toHaveBeenCalledTimes(2)
})

it('keeps task argument ordering and independent change subscriptions', async () => {
  const ipc = transport(), { tasks } = createTasksBridge(ipc)
  await tasks.update('task', { title: 'edited' })
  expect(ipc.invoke).toHaveBeenCalledWith('tasks:update', 'task', { title: 'edited' })
  const one = vi.fn(), two = vi.fn()
  const offOne = tasks.onChanged(one), offTwo = tasks.onChanged(two)
  offOne(); ipc.emit('tasks:changed')
  expect(one).not.toHaveBeenCalled(); expect(two).toHaveBeenCalledOnce()
  offTwo(); expect(ipc.listenerCount('tasks:changed')).toBe(0)
})

it('preserves explicit cancellation transport without closing unrelated subscriptions', () => {
  const ipc = transport(), { ai } = createChatBridge(ipc)
  ai.cancelStream('request')
  expect(ipc.send).toHaveBeenCalledWith('ai:cancel', 'request')
})
