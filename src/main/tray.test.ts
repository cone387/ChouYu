import { afterEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ handlers: new Map<string, () => void>(), template: [] as any[] }))
vi.mock('electron', () => ({
  Tray: class {
    on(name: string, handler: () => void) { state.handlers.set(name, handler) }
    setToolTip() {}
    setContextMenu() {}
    setImage() {}
    isDestroyed() { return false }
  },
  Menu: { buildFromTemplate: (template: any[]) => { state.template = template; return { items: template } } },
  nativeImage: { createFromBuffer: () => ({ resize: () => ({ isEmpty: () => false }) }) },
  ipcMain: { removeAllListeners() {}, on() {} },
  app: { once() {}, quit() {} }
}))
vi.mock('./journal', () => ({ openJournalWorkspace: vi.fn(), toggleJournalPause: vi.fn(), getJournalStatus: () => null }))
vi.mock('./mouse-events', () => ({ setWindowMouseIgnored: vi.fn() }))
import { setupTray, setTrayUnread } from './tray'
import { setWindowMouseIgnored } from './mouse-events'

const platform = process.platform

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: platform })
  state.handlers.clear()
  setTrayUnread(0)
  vi.clearAllMocks()
  vi.clearAllTimers()
  vi.useRealTimers()
})

it.each(['darwin', 'win32'])('%s uses a single tray activation behavior', platform => {
  vi.useFakeTimers()
  Object.defineProperty(process, 'platform', { value: platform })
  const window = { isDestroyed: () => false, isMinimized: () => false, show: vi.fn(), focus: vi.fn(), moveTop: vi.fn(), webContents: { send: vi.fn(), on: vi.fn(), isLoadingMainFrame: () => false } }
  setupTray(window as any)
  if (platform === 'darwin') {
    expect(state.handlers.has('click')).toBe(false)
    expect(state.handlers.has('double-click')).toBe(false)
    expect(window.show).not.toHaveBeenCalled()
    state.template.find(item => item.label === '打开工作区').click()
  } else state.handlers.get('click')!()
  expect(window.show).toHaveBeenCalledOnce()
  expect(window.webContents.send).toHaveBeenCalledWith('open-chat-panel')
  expect(setWindowMouseIgnored).toHaveBeenCalledWith(false)
})

it.each([0, 1])('retains an early tray activation while the page loads (unread=%s)', unread => {
  vi.useFakeTimers()
  Object.defineProperty(process, 'platform', { value: 'win32' })
  let loaded: () => void = () => {}
  const window = {
    isDestroyed: () => false, isMinimized: () => true, restore: vi.fn(),
    show: vi.fn(), focus: vi.fn(), moveTop: vi.fn(),
    webContents: { send: vi.fn(), isLoadingMainFrame: () => true, on: (_: string, handler: () => void) => { loaded = handler } }
  }
  setupTray(window as any)
  setTrayUnread(unread)
  state.handlers.get('click')!()
  state.handlers.get('double-click')!()
  expect(window.webContents.send).not.toHaveBeenCalled()
  loaded()
  expect(window.restore).toHaveBeenCalledOnce()
  expect(window.show).toHaveBeenCalledOnce()
  expect(setWindowMouseIgnored).toHaveBeenCalledWith(false)
  expect(window.webContents.send).toHaveBeenCalledExactlyOnceWith(unread ? 'open-assistant-chat' : 'open-chat-panel')
  loaded()
  expect(window.show).toHaveBeenCalledOnce()
})
