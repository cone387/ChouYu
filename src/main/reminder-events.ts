import { BrowserWindow } from 'electron'
import { getAssistantUnreadCount } from './database'
import { setTrayUnread } from './tray'
/** All proactive messages, including contact work, receive the same unread signal. */
export function notifyReminderChanges(): void {
  const count = getAssistantUnreadCount()
  setTrayUnread(count)
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.webContents.send('sessions:changed', true)
    window.webContents.send('assistant-unread-changed', count)
  }
}
