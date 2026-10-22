import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

const mocks = vi.hoisted(() => ({ cancel: vi.fn(), handle: vi.fn() }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  return { app: Object.assign(new EventEmitter(), { getPath: () => '/unused' }), ipcMain: { handle: mocks.handle }, BrowserWindow: {} }
})
vi.mock('../database', () => ({ getConfig: () => ({ aiToolsEnabled: true }), getState: () => null, getCharacter: () => ({ id: 'a' }) }))
vi.mock('./library', () => ({ SkillLibrary: class {} }))
vi.mock('./runner', () => ({ SkillRunner: class { updateToolPolicy() {} cancel = mocks.cancel } }))
vi.mock('./catalog', () => ({ SkillCatalog: class {} }))
vi.mock('./tools', () => ({ SKILL_TOOLS: [] }))
import { app } from 'electron'
import { registerSkillHandlers } from './index'
import { registerDomain } from '../ipc/registration'

it('releases skill handlers and quit listener without touching another owner', () => {
  const handlers = new Map<string, unknown>()
  const bus = Object.assign(new EventEmitter(), {
    handle(name: string, handler: unknown) {
      if (handlers.has(name)) throw new Error('duplicate')
      handlers.set(name, handler)
    },
    removeHandler(name: string) { handlers.delete(name) }
  })
  const peer = vi.fn()
  app.on('before-quit', peer)
  const install = () => registerDomain(bus, ipc => ipc.cleanup(registerSkillHandlers({} as BrowserWindow, ipc)))
  const dispose = install()
  expect(handlers.has('skills:cancel')).toBe(true)
  expect(app.listenerCount('before-quit')).toBe(2)
  dispose(); dispose()
  expect(handlers.size).toBe(0)
  expect(app.listenerCount('before-quit')).toBe(1)
  expect(mocks.cancel).toHaveBeenCalledTimes(1)
  const second = install()
  second()
  app.removeListener('before-quit', peer)
})
