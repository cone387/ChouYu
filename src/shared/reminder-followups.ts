import type { TaskReminderRef } from './reminders'

export type ReminderSource =
  | { kind: 'todo'; ref: TaskReminderRef }
  | { kind: 'interaction'; interactionId: string }
  | { kind: 'contact-task'; topicId: string; runId: string; actionable: boolean }
  | { kind: 'message'; routineId?: string }
export type ReminderStatus = 'pending' | 'processed' | 'obsolete'
export interface ReminderItem {
  id: string
  owner: string
  sessionId: string
  messageId: string
  locations?: { sessionId: string; messageId: string }[]
  label: string
  source: ReminderSource
  acknowledgement: 'received' | 'done' | 'action' | 'task'
  status: ReminderStatus
  intervalMinutes: number
  nextAt: number
  createdAt: number
  revision: number
  lastRemindedAt?: number
  processedAt?: number
  reason?: string
  error?: string
  postponed?: boolean
}
export interface ReminderView extends ReminderItem { read: boolean }
export type ReminderAction = 'read' | 'acknowledge' | 'complete' | 'postpone' | 'interval' | 'resume'
export interface ReminderSourceState { status: ReminderStatus; reason?: string; label?: string; location?: { sessionId: string; messageId: string } }
export const REMINDER_STATE_PREFIX = 'reminder-item:'
export function validateReminderMinutes(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 1440) throw new Error('提醒间隔应为 1～1440 分钟的整数。')
  return Number(value)
}
export function parseReminderItem(raw: string): ReminderItem {
  const v = JSON.parse(raw) as ReminderItem
  if (!v || typeof v.id !== 'string' || typeof v.owner !== 'string' || typeof v.sessionId !== 'string' || typeof v.messageId !== 'string'
    || typeof v.label !== 'string' || !['pending', 'processed', 'obsolete'].includes(v.status)
    || !['received', 'done', 'action', 'task'].includes(v.acknowledgement)
    || !Number.isFinite(v.createdAt) || !Number.isFinite(v.nextAt) || !Number.isSafeInteger(v.revision) || v.revision < 1
    || !v.source || !['todo', 'interaction', 'contact-task', 'message'].includes(v.source.kind)) throw new Error('提醒记录损坏，请恢复数据后重试。')
  validateReminderMinutes(v.intervalMinutes)
  if (v.source.kind === 'todo' && (!v.source.ref || typeof v.source.ref.taskId !== 'string' || !Number.isFinite(v.source.ref.reminderAt))) throw new Error('任务提醒来源损坏。')
  if (v.source.kind === 'interaction' && typeof v.source.interactionId !== 'string') throw new Error('处理事项来源损坏。')
  if (v.source.kind === 'contact-task' && (typeof v.source.topicId !== 'string' || typeof v.source.runId !== 'string')) throw new Error('联系人任务来源损坏。')
  return v
}
