import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ updater: null as any, app: null as any, power: null as any, dialog: vi.fn() }))
vi.mock('electron-updater', () => ({ get autoUpdater() { return fixture.updater } }))
vi.mock('electron', () => ({ get app() { return fixture.app }, get powerMonitor() { return fixture.power }, dialog: { showMessageBox: fixture.dialog } }))

beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers(); vi.stubEnv('CHOUYU_SMOKE_TEST', '0')
  fixture.updater = Object.assign(new EventEmitter(), {
    checkForUpdates: vi.fn(async () => { fixture.updater.emit('update-not-available'); return null }),
    downloadUpdate: vi.fn(async () => []), quitAndInstall: vi.fn()
  })
  fixture.app = Object.assign(new EventEmitter(), { isPackaged: true, quit: vi.fn(), relaunch: vi.fn() })
  fixture.power = new EventEmitter()
  fixture.dialog.mockReset()
})
afterEach(() => { fixture.app.emit('will-quit'); vi.useRealTimers(); vi.unstubAllEnvs() })
function host() {
  let destroyed = false
  const send = vi.fn(() => { if (destroyed) throw new Error('Window destroyed') })
  const window = { isDestroyed: () => destroyed, webContents: { isDestroyed: () => destroyed, send } } as unknown as BrowserWindow
  return { window, send, close: () => { destroyed = true } }
}

it('initializes once, quietly downloads, and gives late readers the current snapshot', async () => {
  const { initAutoUpdater, installPendingUpdate } = await import('./updater')
  const target = host()
  const service = initAutoUpdater(target.window)
  expect(initAutoUpdater(target.window)).toBe(service)
  await vi.advanceTimersByTimeAsync(30000)
  expect(fixture.updater.checkForUpdates).toHaveBeenCalledOnce()
  fixture.updater.emit('update-available', { version: '1.4.7' })
  await vi.advanceTimersByTimeAsync(0)
  fixture.updater.emit('update-downloaded', { version: '1.4.7' })
  expect(initAutoUpdater(target.window).snapshot()).toMatchObject({ phase: 'ready', version: '1.4.7' })
  expect(fixture.dialog).not.toHaveBeenCalled()
  expect(fixture.updater.downloadUpdate).toHaveBeenCalledOnce()
  expect(fixture.app.quit).not.toHaveBeenCalled()
  service.requestInstall()
  expect(fixture.app.quit).toHaveBeenCalledOnce()
  expect(fixture.updater.quitAndInstall).not.toHaveBeenCalled()
  installPendingUpdate()
  expect(fixture.updater.quitAndInstall).toHaveBeenCalledExactlyOnceWith(true, true)
})

it('safely handles a destroyed window and sends subsequent state to its replacement', async () => {
  const { initAutoUpdater } = await import('./updater')
  const target = host()
  const service = initAutoUpdater(target.window)
  target.close()
  await service.check()
  expect(target.send).not.toHaveBeenCalled()
  const replacement = host()
  initAutoUpdater(replacement.window)
  await service.check()
  expect(replacement.send).toHaveBeenLastCalledWith('update:state', expect.objectContaining({ phase: 'upToDate' }))
  expect(fixture.updater.listenerCount('update-available')).toBe(1)
  fixture.app.emit('will-quit')
  expect(fixture.power.listenerCount('resume')).toBe(0)
  expect(fixture.updater.listenerCount('update-available')).toBe(0)
})

it.each(['development', 'smoke'])('does not contact the release server in %s mode', async mode => {
  if (mode === 'development') fixture.app.isPackaged = false
  else vi.stubEnv('CHOUYU_SMOKE_TEST', '1')
  const { initAutoUpdater } = await import('./updater')
  const service = initAutoUpdater(host().window)
  await service.check()
  await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
  expect(service.snapshot().phase).toBe('unsupported')
  expect(fixture.updater.checkForUpdates).not.toHaveBeenCalled()
})

it('reopens a usable app with an inline error if installer handoff fails after storage is closed', async () => {
  const { initAutoUpdater, installPendingUpdate, hasPendingUpdateInstall } = await import('./updater')
  const service = initAutoUpdater(host().window)
  fixture.updater.emit('update-downloaded', { version: '1.4.7' })
  service.requestInstall()
  expect(hasPendingUpdateInstall()).toBe(true)
  fixture.updater.quitAndInstall.mockImplementation(() => fixture.updater.emit('error', new Error('installer failed')))
  installPendingUpdate()
  expect(hasPendingUpdateInstall()).toBe(false)
  expect(fixture.app.relaunch).toHaveBeenCalledExactlyOnceWith({ args: expect.arrayContaining(['--update-install-failed']) })
  expect(fixture.dialog).not.toHaveBeenCalled()
})
