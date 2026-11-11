import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { UpdateService } from './update-service'

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-11T00:00:00Z')) })
afterEach(() => { vi.useRealTimers() })
function fixture() {
  const backend = Object.assign(new EventEmitter(), {
    autoDownload: true, autoInstallOnAppQuit: true,
    checkForUpdates: vi.fn(async () => { backend.emit('update-not-available'); return null }),
    downloadUpdate: vi.fn(async () => []), quitAndInstall: vi.fn()
  })
  const notify = vi.fn(), quit = vi.fn()
  const service = new UpdateService(backend, notify, quit)
  service.start()
  return { service, backend, notify, quit }
}

it('checks after startup and periodically, with no duplicate startup check after a manual check', async () => {
  const { service, backend } = fixture()
  expect(backend.checkForUpdates).not.toHaveBeenCalled()
  await service.check()
  await vi.advanceTimersByTimeAsync(30000)
  expect(backend.checkForUpdates).toHaveBeenCalledTimes(1)
  expect(service.snapshot().phase).toBe('upToDate')
  await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000)
  expect(backend.checkForUpdates).toHaveBeenCalledTimes(2)
  service.dispose()
})

it('downloads a new version once, preserves ready state across stale checks, and never restarts automatically', async () => {
  const { service, backend, quit } = fixture()
  let finish!: () => void
  backend.downloadUpdate.mockImplementation(() => new Promise(resolve => { finish = () => resolve([]) }))
  backend.emit('update-available', { version: '1.4.7' })
  backend.emit('update-available', { version: '1.4.7' })
  await vi.advanceTimersByTimeAsync(0)
  expect(backend.downloadUpdate).toHaveBeenCalledTimes(1)
  backend.emit('download-progress', { percent: 34.8 })
  expect(service.snapshot()).toMatchObject({ phase: 'downloading', version: '1.4.7', percent: 34.8 })
  backend.emit('update-downloaded', { version: '1.4.7' })
  finish()
  await vi.advanceTimersByTimeAsync(0)
  backend.emit('update-not-available')
  await service.check()
  expect(service.snapshot()).toMatchObject({ phase: 'ready', version: '1.4.7' })
  expect(quit).not.toHaveBeenCalled()
  expect(backend.autoInstallOnAppQuit).toBe(false)
  expect(backend.quitAndInstall).not.toHaveBeenCalled()
  service.dispose()
})

it('reports emitted plus rejected download errors once and allows an explicit retry', async () => {
  const { service, backend, notify } = fixture()
  backend.downloadUpdate.mockImplementationOnce(async () => {
    const error = new Error('network ECONNRESET secret-token-value')
    backend.emit('error', error)
    throw error
  })
  backend.emit('update-available', { version: '1.4.7' })
  await vi.advanceTimersByTimeAsync(0)
  expect(service.snapshot()).toMatchObject({ phase: 'error', errorStage: 'download', version: '1.4.7' })
  expect(service.snapshot().error).not.toContain('secret-token-value')
  expect(notify.mock.calls.filter(([state]) => state.phase === 'error')).toHaveLength(1)
  await service.download()
  expect(backend.downloadUpdate).toHaveBeenCalledTimes(2)
  expect(service.snapshot().phase).toBe('downloading')
  service.dispose()
})

it('only installs after the existing quit guard completes, and can withdraw a cancelled quit', () => {
  const { service, backend, quit } = fixture()
  service.requestInstall()
  expect(quit).not.toHaveBeenCalled()
  backend.emit('update-downloaded', { version: '1.4.7' })
  service.requestInstall()
  service.requestInstall()
  expect(quit).toHaveBeenCalledTimes(1)
  expect(backend.quitAndInstall).not.toHaveBeenCalled()
  service.cancelInstall()
  service.installAfterCleanup()
  expect(service.snapshot().phase).toBe('ready')
  expect(backend.quitAndInstall).not.toHaveBeenCalled()
  service.requestInstall()
  service.installAfterCleanup()
  service.installAfterCleanup()
  expect(backend.quitAndInstall).toHaveBeenCalledExactlyOnceWith(true, true)
  service.dispose()
})

it('deduplicates concurrent checks and retains checking until a real result arrives', async () => {
  const { service, backend } = fixture()
  let finish!: () => void
  backend.checkForUpdates.mockImplementation(() => new Promise(resolve => { finish = () => resolve(null) }))
  const first = service.check(), second = service.check()
  await vi.advanceTimersByTimeAsync(10000)
  expect(backend.checkForUpdates).toHaveBeenCalledTimes(1)
  expect(service.snapshot().phase).toBe('checking')
  backend.emit('update-not-available'); finish()
  await Promise.all([first, second])
  expect(service.snapshot().phase).toBe('upToDate')
  service.dispose()
})

it('cleans up owned listeners and timers and does not check too often on resume', async () => {
  const { service, backend } = fixture()
  const peer = vi.fn(); backend.on('update-available', peer)
  await service.check()
  service.resume()
  await vi.advanceTimersByTimeAsync(30000)
  expect(backend.checkForUpdates).toHaveBeenCalledTimes(1)
  service.dispose()
  await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
  backend.emit('update-available', { version: '1.4.7' })
  expect(backend.checkForUpdates).toHaveBeenCalledTimes(1)
  expect(backend.downloadUpdate).not.toHaveBeenCalled()
  expect(peer).toHaveBeenCalledOnce()
})

it('continues automatic checks after a download spans a check interval and fails', async () => {
  const { service, backend } = fixture()
  let fail!: (error: Error) => void
  backend.downloadUpdate.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
  await service.check()
  backend.emit('update-available', { version: '1.4.7' })
  await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000)
  expect(backend.checkForUpdates).toHaveBeenCalledTimes(1)
  fail(new Error('network timeout'))
  await vi.advanceTimersByTimeAsync(60_000)
  expect(backend.checkForUpdates).toHaveBeenCalledTimes(2)
  service.dispose()
})
