import { afterEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ handlers: new Map<string, () => void>(), template: [] as any[] }))
vi.mock('electron', () => ({
  Tray: class {
    on(name: string, handler: () => void) { state.handlers.set(name, handler) }
    setToolTip() {}
    setContextMenu() {}
  },
  Menu: { buildFromTemplate: (template: any[]) => { state.template = template; return { items: template } } },
  nativeImage: { createFromBuffer: () => ({ resize: () => ({ isEmpty: () => false }) }) },
  ipcMain: { removeAllListeners() {}, on() {} },
  app: { once() {}, quit() {} }
}))
vi.mock('./journal', () => ({ openJournalWorkspace: vi.fn(), toggleJournalPause: vi.fn(), getJournalStatus: () => null }))
import { setupTray } from './tray'

const platform = process.platform

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: platform })
  state.handlers.clear()
  vi.clearAllTimers()
  vi.useRealTimers()
})

it.each(['darwin', 'win32'])('%s uses a single tray activation behavior', platform => {
  vi.useFakeTimers()
  Object.defineProperty(process, 'platform', { value: platform })
  const window = { isMinimized: () => false, show: vi.fn(), focus: vi.fn(), moveTop: vi.fn(), webContents: { send: vi.fn() } }
  setupTray(window as any)
  if (platform === 'darwin') {
    expect(state.handlers.has('click')).toBe(false)
    expect(state.handlers.has('double-click')).toBe(false)
    expect(window.show).not.toHaveBeenCalled()
    state.template.find(item => item.label === '打开工作区').click()
  } else state.handlers.get('click')!()
  expect(window.show).toHaveBeenCalledOnce()
  expect(window.webContents.send).toHaveBeenCalledWith('open-chat-panel')
})
