import { BrowserWindow } from 'electron'
import { getAssistantUnreadCount, getAssistantUnreadPreview } from './database'
import { setTrayUnread } from './tray'
/** All proactive messages, including contact work, receive the same unread signal. */
export function notifyReminderChanges(): void {
  const count = getAssistantUnreadCount()
  const errors: unknown[] = []
  try { setTrayUnread(count, getAssistantUnreadPreview()) } catch (error) { errors.push(error) }
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    for (const [channel, value] of [['sessions:changed', true], ['assistant-unread-changed', count]] as const) {
      try { window.webContents.send(channel, value) } catch (error) { errors.push(error) }
    }
  }
  if (errors.length) throw new AggregateError(errors, '部分消息通知未送达，将重试。')
}
