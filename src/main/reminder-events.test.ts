import { expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ windows: [] as any[], tray: vi.fn() }))
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => state.windows } }))
vi.mock('./database', () => ({ getAssistantUnreadCount: () => 3, getAssistantUnreadPreview: () => '新消息' }))
vi.mock('./tray', () => ({ setTrayUnread: state.tray }))
import { notifyReminderChanges } from './reminder-events'

it('notifies other live windows even when one renderer throws, then reports retryable failure', () => {
  const live = vi.fn(), destroyed = vi.fn()
  state.windows = [
    { isDestroyed: () => false, webContents: { send: () => { throw new Error('renderer gone') } } },
    { isDestroyed: () => true, webContents: { send: destroyed } },
    { isDestroyed: () => false, webContents: { send: live } }
  ]
  expect(() => notifyReminderChanges()).toThrow()
  expect(live).toHaveBeenCalledWith('sessions:changed', true)
  expect(live).toHaveBeenCalledWith('assistant-unread-changed', 3)
  expect(destroyed).not.toHaveBeenCalled()
  expect(state.tray).toHaveBeenCalledWith(3, '新消息')
})
