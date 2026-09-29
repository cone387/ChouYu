export interface TaskReminderRef { taskId: string; checklistId?: string; reminderAt: number }
export interface AssistantSnooze { id: string; key: string; content: string; dueAt: number; taskRef?: TaskReminderRef }
export interface ReminderAPI {
  list(): Promise<AssistantSnooze[]>
  schedule(sessionId: string, messageId: string, minutes: number): Promise<AssistantSnooze>
  cancel(key: string): Promise<void>
}
export function normalizeTaskReminderRef(raw: unknown): TaskReminderRef | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as TaskReminderRef
  if (typeof r.taskId !== 'string' || !r.taskId || r.taskId.length > 200 || !Number.isFinite(r.reminderAt)) return undefined
  if (r.checklistId !== undefined && (typeof r.checklistId !== 'string' || !r.checklistId || r.checklistId.length > 200)) return undefined
  return { taskId: r.taskId, reminderAt: r.reminderAt, ...(r.checklistId ? { checklistId: r.checklistId } : {}) }
}
export function reminderKey(sessionId: string, message: { id: string; taskReminder?: TaskReminderRef; snoozeKey?: string }): string {
  if (message.snoozeKey) return message.snoozeKey
  const r = message.taskReminder
  return r ? JSON.stringify([r.taskId, r.checklistId ?? '', r.reminderAt]) : `${sessionId}:${message.id}`
}
