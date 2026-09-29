import { ipcMain } from 'electron'
import { appendAssistantMessage, getSession, getState, setState } from '../database'
import { notifyReminderChanges } from '../reminder-events'
import { resolveTaskReminder } from '../tasks'
import { SnoozeService } from './service'
let timer: ReturnType<typeof setInterval> | undefined
export function initializeReminders(): void {
  const service = new SnoozeService({
    read: () => getState('assistant-snoozes'),
    write: value => setState('assistant-snoozes', value),
    message: (sessionId, messageId) => getSession(sessionId)?.messages.find(m => m.id === messageId),
    task: resolveTaskReminder,
    append: (item, content) => { appendAssistantMessage(content, undefined, 'snooze', { receiptIds: [`snooze:${item.id}`], taskReminder: item.taskRef, snoozeKey: item.key }); notifyReminderChanges() },
    changed: notifyReminderChanges
  })
  ipcMain.handle('reminders:list', () => service.list())
  ipcMain.handle('reminders:schedule', (_event, sessionId: string, messageId: string, minutes: number) => {
    if (typeof sessionId !== 'string' || typeof messageId !== 'string') throw new Error('提醒来源无效。')
    return service.schedule(sessionId, messageId, minutes)
  })
  ipcMain.handle('reminders:cancel', (_event, key: string) => { if (typeof key !== 'string') throw new Error('提醒无效。'); service.cancel(key) })
  const tick = () => { try { service.tick() } catch { /* Do not overwrite unreadable state. */ } }
  tick()
  timer = setInterval(tick, 15_000)
}
export function closeReminders(): void {
  if (timer) clearInterval(timer)
  for (const name of ['list', 'schedule', 'cancel']) ipcMain.removeHandler(`reminders:${name}`)
}
