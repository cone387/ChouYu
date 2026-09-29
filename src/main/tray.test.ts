import { afterEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ handlers: new Map<string, () => void>(), template: [] as any[], tooltip: '', journal: null as any, setImage: vi.fn() }))
vi.mock('electron', () => ({
  Tray: class {
    on(name: string, handler: () => void) { state.handlers.set(name, handler) }
    setToolTip(text: string) { state.tooltip = text }
    setContextMenu() {}
    setImage = state.setImage
    isDestroyed() { return false }
  },
  Menu: { buildFromTemplate: (template: any[]) => { state.template = template; return { items: template, getMenuItemById: (id: string) => template.find(item => item.id === id) } } },
  nativeImage: { createFromBuffer: () => ({ resize: () => ({ isEmpty: () => false }) }) },
  ipcMain: { removeAllListeners() {}, on() {} },
  app: { once() {}, quit() {} }
}))
vi.mock('./journal', () => ({ openJournalWorkspace: vi.fn(), toggleJournalPause: vi.fn(), getJournalStatus: () => state.journal }))
vi.mock('./mouse-events', () => ({ setWindowMouseIgnored: vi.fn() }))
import { setupTray, setTrayUnread } from './tray'
import { setWindowMouseIgnored } from './mouse-events'

const platform = process.platform

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: platform })
  state.handlers.clear()
  setTrayUnread(0)
  state.journal = null
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

it('prioritizes unread previews across journal refreshes and keeps flashing until read', () => {
  vi.useFakeTimers()
  state.journal = { state: 'recording', config: { enabled: true, paused: false, captureEnabled: false } }
  const window = { webContents: { on: vi.fn() } }
  setupTray(window as any)
  setTrayUnread(2, '助手：回来啦，休息一下吧')
  expect(state.tooltip).toBe('ChouYu · 2 条未读消息\n助手：回来啦，休息一下吧')
  vi.advanceTimersByTime(3000)
  expect(state.tooltip).toContain('回来啦')
  expect(state.tooltip).not.toContain('活动记录')
  expect(state.setImage).toHaveBeenCalledTimes(5)
  expect(state.template.find(item => item.id === 'journal-state').label).toContain('正在记录')
  setTrayUnread(1, '阿笔：小说有新进展')
  expect(state.tooltip).toContain('阿笔：小说有新进展')
  setTrayUnread(0)
  expect(state.tooltip).toContain('活动记录正在记录')
  expect(state.tooltip).not.toContain('小说')
  state.setImage.mockClear()
  vi.advanceTimersByTime(3000)
  expect(state.setImage).not.toHaveBeenCalled()
})

it('shows unread messages even before journal initialization and bounds tooltip length', () => {
  vi.useFakeTimers()
  setTrayUnread(1, '助手：' + '新消息'.repeat(100))
  setupTray({ webContents: { on: vi.fn() } } as any)
  expect(state.tooltip).toContain('1 条未读消息')
  expect(state.tooltip.length).toBeLessThanOrEqual(127)
  vi.advanceTimersByTime(600)
  expect(state.setImage).toHaveBeenCalled()
  setTrayUnread(0)
  expect(state.tooltip).toBe('ChouYu')
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
