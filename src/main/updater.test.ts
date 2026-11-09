import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ updater: null as any, dialog: vi.fn() }))
vi.mock('electron-updater', () => ({ get autoUpdater() { return fixture.updater } }))
vi.mock('electron', () => ({ dialog: { showMessageBox: fixture.dialog } }))

beforeEach(() => {
  vi.resetModules()
  fixture.updater = Object.assign(new EventEmitter(), {
    checkForUpdates: vi.fn(async () => null),
    downloadUpdate: vi.fn(async () => []),
    quitAndInstall: vi.fn()
  })
  fixture.dialog.mockReset().mockResolvedValue({ response: 1 })
})

const turn = () => new Promise(resolve => setImmediate(resolve))
function host() {
  let destroyed = false
  const messages: { channel: string; payload: unknown }[] = []
  const window = {
    isDestroyed: () => destroyed,
    webContents: {
      isDestroyed: () => destroyed,
      send: (channel: string, payload: unknown) => {
        if (destroyed) throw new Error('Object has been destroyed')
        messages.push({ channel, payload })
      }
    }
  } as unknown as BrowserWindow
  return { window, messages, close: () => { destroyed = true } }
}

it('reports failed first and repeated update checks without unhandled rejections or duplicate listeners', async () => {
  const { initAutoUpdater } = await import('./updater')
  const target = host()
  // Match electron-updater: error is emitted and the returned promise rejects.
  fixture.updater.checkForUpdates = async () => {
    const error = new Error('network ENOTFOUND')
    fixture.updater.emit('error', error)
    throw error
  }
  initAutoUpdater(target.window)
  await turn()
  initAutoUpdater(target.window)
  await turn()
  expect(target.messages).toEqual([
    { channel: 'update:error', payload: '更新检查失败：无法连接更新服务器，请检查网络后重试。' },
    { channel: 'update:error', payload: '更新检查失败：无法连接更新服务器，请检查网络后重试。' }
  ])
})

it('keeps download opt-in and reports a failed approved download once without an unhandled rejection', async () => {
  const { initAutoUpdater } = await import('./updater')
  const target = host()
  initAutoUpdater(target.window)
  fixture.updater.emit('update-available', { version: '1.4.3' })
  await turn()
  expect(fixture.updater.downloadUpdate).not.toHaveBeenCalled()
  fixture.dialog.mockResolvedValue({ response: 0 })
  let downloads = 0
  fixture.updater.downloadUpdate = async () => {
    downloads++
    await Promise.resolve()
    const error = new Error('network ECONNRESET')
    fixture.updater.emit('error', error)
    throw error
  }
  fixture.updater.emit('update-available', { version: '1.4.3' })
  await turn()
  expect(downloads).toBe(1)
  expect(target.messages.filter(m => ['update:downloading', 'update:error'].includes(m.channel))).toEqual([
    { channel: 'update:downloading', payload: undefined },
    { channel: 'update:error', payload: '更新检查失败：无法连接更新服务器，请检查网络后重试。' }
  ])
})

it.each(['update-available', 'update-downloaded'])('ignores late events and %s confirmation after the window closes', async event => {
  const { initAutoUpdater } = await import('./updater')
  const target = host()
  let answer!: (value: { response: number }) => void
  fixture.dialog.mockReturnValue(new Promise(resolve => { answer = resolve }))
  initAutoUpdater(target.window)
  fixture.updater.emit(event, { version: '1.4.3' })
  target.close()
  answer({ response: 0 })
  await turn()
  expect(() => fixture.updater.emit('download-progress', { percent: 50 })).not.toThrow()
  expect(() => fixture.updater.emit('error', new Error('network timeout'))).not.toThrow()
  expect(fixture.updater.downloadUpdate).not.toHaveBeenCalled()
  expect(fixture.updater.quitAndInstall).not.toHaveBeenCalled()
  expect(target.messages.map(m => m.channel)).toEqual([event === 'update-available' ? 'update:available' : 'update:downloaded'])
})

it('reports a rejected confirmation dialog and waits for consent before installing', async () => {
  const { initAutoUpdater } = await import('./updater')
  const target = host()
  initAutoUpdater(target.window)
  fixture.dialog.mockRejectedValueOnce(new Error('Dialog unavailable'))
  fixture.updater.emit('update-available', { version: '1.4.3' })
  await turn()
  expect(target.messages.at(-1)?.channel).toBe('update:error')
  fixture.updater.emit('update-downloaded', { version: '1.4.3' })
  await turn()
  expect(fixture.updater.quitAndInstall).not.toHaveBeenCalled()
  fixture.dialog.mockResolvedValueOnce({ response: 0 })
  fixture.updater.emit('update-downloaded', { version: '1.4.3' })
  await turn()
  expect(fixture.updater.quitAndInstall).toHaveBeenCalledExactlyOnceWith(false, true)
})
