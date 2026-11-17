import { ipcMain } from 'electron'
import { getSession, getSessions, getState, setState, getReminderItems, saveReminderItems, markReminderRead, appendReminderFollowup, getReminderLocations, hasPersistedReminderReceipt } from '../database'
import { deliverMessage } from '../messaging'
import { notifyReminderChanges } from '../reminder-events'
import { resolveTaskReminder } from '../tasks'
import { SnoozeService } from './service'
import { FollowupService } from './followups'
import { reminderSourceState, completeReminderTask } from './sources'
import { reminderSourceVersion } from './source-versions'
import type { ReminderAction } from '../../shared/reminder-followups'
import { createReminderTools } from './tools'
import { getRegisteredTool, registerTool } from '../tools/registry'
let timer: ReturnType<typeof setInterval> | undefined
let followups: FollowupService | undefined
export function initializeReminders(): void {
  followups = new FollowupService({ items: getReminderItems, save: saveReminderItems, source: reminderSourceState, complete: completeReminderTask,
    markRead: markReminderRead,
    isRead: item => getReminderLocations(item).some(location => location.read), sourceVersion: reminderSourceVersion,
    deliver: appendReminderFollowup, delivered: hasPersistedReminderReceipt, changed: notifyReminderChanges })
  const active = followups
  for (const tool of createReminderTools({ list: sessionId => {
    if (!followups) throw new Error('提醒服务尚未就绪。')
    return followups.list(sessionId)
  }, act: (id, revision, action, minutes) => {
    if (!followups) throw new Error('提醒服务尚未就绪。')
    return followups.act(id, revision, action, minutes)
  } })) if (!getRegisteredTool(tool.name)) registerTool(tool)
  const service = new SnoozeService({
    read: () => getState('assistant-snoozes'),
    write: value => setState('assistant-snoozes', value),
    message: (sessionId, messageId) => getSession(sessionId)?.messages.find(m => m.id === messageId),
    task: resolveTaskReminder,
    append: (item, content) => { deliverMessage({ kind: 'assistant', content, messageKind: 'snooze', receiptIds: [`snooze:${item.id}`], taskReminder: item.taskRef, snoozeKey: item.key }) },
    changed: notifyReminderChanges
  })
  ipcMain.handle('reminders:items', (_event, sessionId: string) => {
    if (typeof sessionId !== 'string' || !getSessions().some(session => session.id === sessionId)) throw new Error('提醒会话不存在。')
    return active.list(sessionId)
  })
  ipcMain.handle('reminders:act', (_event, id: string, revision: number, action: ReminderAction, minutes?: number) => {
    if (typeof id !== 'string' || !Number.isSafeInteger(revision)) throw new Error('提醒来源无效。')
    return active.act(id, revision, action, minutes)
  })
  ipcMain.handle('reminders:list', () => [...service.list(), ...getReminderItems().filter(item => item.status === 'pending' && item.postponed).map(item => ({ id: item.id, key: item.id, content: item.label, dueAt: item.nextAt, ...(item.source.kind === 'todo' ? { taskRef: item.source.ref } : {}) }))])
  ipcMain.handle('reminders:schedule', async (_event, sessionId: string, messageId: string, minutes: number) => {
    if (typeof sessionId !== 'string' || typeof messageId !== 'string') throw new Error('提醒来源无效。')
    const message = getSession(sessionId)?.messages.find(message => message.id === messageId)
    if (message?.reminderIds?.length) {
      if (message.reminderIds.length !== 1) throw new Error('请选择一条提醒操作。')
      const item = getReminderItems().find(item => item.id === message.reminderIds![0])
      if (!item || item.status !== 'pending') throw new Error('该提醒已处理或失效，无需再次提醒。')
      const saved = await active.act(item.id, item.revision, 'postpone', minutes)
      return { id: saved.id, key: saved.id, content: saved.label, dueAt: saved.nextAt }
    }
    return service.schedule(sessionId, messageId, minutes)
  })
  ipcMain.handle('reminders:cancel', async (_event, key: string) => {
    if (typeof key !== 'string') throw new Error('提醒无效。')
    const item = getReminderItems().find(item => item.id === key)
    if (item) await active.act(item.id, item.revision, 'resume')
    else service.cancel(key)
  })
  const tick = () => { try { service.tick() } catch { /* Do not overwrite unreadable legacy state. */ }
    void active.tick().catch(error => console.error('持续提醒读取失败:', error instanceof Error ? error.message : error)) }
  tick()
  timer = setInterval(tick, 15_000)
}
export function closeReminders(): void {
  if (timer) clearInterval(timer)
  followups?.stop(); followups = undefined; timer = undefined
  for (const name of ['list', 'schedule', 'cancel', 'items', 'act']) ipcMain.removeHandler(`reminders:${name}`)
}
