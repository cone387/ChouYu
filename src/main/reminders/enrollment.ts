import { createHash } from 'node:crypto'
import type { Message } from '../../shared/conversations'
import { REMINDER_STATE_PREFIX, parseReminderItem, type ReminderItem, type ReminderSource } from '../../shared/reminder-followups'
import type { TaskReminderRef } from '../../shared/reminders'

/** First delivery and enrollment share the application's existing commit boundary. */
export function enrollReminders(message: Message, sessionId: string, owner: string, read: (key: string) => string | null,
  tasks?: { ref: TaskReminderRef; title: string }[]): { ids: string[]; values: Record<string, string> } {
  if (message.reminderFollowup) return { ids: message.reminderIds ?? [], values: {} }
  const origin = message.communication?.source
  const interactionId = message.agentNotice?.interactionId ?? (origin?.kind === 'interaction' ? origin.interactionId : undefined)
  const source: ReminderSource = message.taskReminder ? { kind: 'todo', ref: message.taskReminder }
    : interactionId ? { kind: 'interaction', interactionId }
      : origin?.kind === 'task' ? { kind: 'contact-task', topicId: origin.topicId, runId: origin.runId, actionable: ['question', 'blocker'].includes(message.communication!.intent) }
        : { kind: 'message', ...(origin?.kind === 'proactive' && origin.eventIds[0]?.startsWith('routine:') ? { routineId: origin.eventIds[0].split(':')[1] } : {}) }
  const entries = tasks?.length ? tasks.map(task => ({ source: { kind: 'todo', ref: task.ref } as ReminderSource, label: task.title }))
    : [{ source, label: message.content.split('\n').find(line => line.trim())?.slice(0, 120) ?? '提醒' }]
  const values: Record<string, string> = {}, ids: string[] = []
  for (const entry of entries) {
    const s = entry.source
    const key = s.kind === 'todo' ? [owner, 'todo', s.ref.taskId, s.ref.checklistId ?? '']
      : s.kind === 'interaction' ? [owner, 'interaction', s.interactionId] : [owner, message.id]
    const id = createHash('sha256').update(JSON.stringify(key)).digest('hex').slice(0, 32)
    const raw = read(REMINDER_STATE_PREFIX + id), previous = raw ? parseReminderItem(raw) : undefined
    const now = Date.now()
    const locations = [...(previous?.locations ?? (previous ? [{ sessionId: previous.sessionId, messageId: previous.messageId }] : [])), { sessionId, messageId: message.id }]
      .filter((location, index, all) => all.findIndex(other => other.sessionId === location.sessionId && other.messageId === location.messageId) === index)
    const item: ReminderItem = previous?.status === 'pending' ? { ...previous, sessionId, messageId: message.id, locations, source: s, label: entry.label, revision: previous.revision + 1 }
      : { id, owner, sessionId, messageId: message.id, source: s, label: entry.label,
        locations: [{ sessionId, messageId: message.id }],
        acknowledgement: s.kind === 'todo' ? 'task' : s.kind === 'interaction' || s.kind === 'contact-task' && s.actionable ? 'action' : message.assistantKind === 'rest' ? 'done' : 'received',
        status: 'pending', intervalMinutes: previous?.intervalMinutes ?? 30, nextAt: now + (previous?.intervalMinutes ?? 30) * 60_000,
        createdAt: now, revision: (previous?.revision ?? 0) + 1 }
    ids.push(id); values[REMINDER_STATE_PREFIX + id] = JSON.stringify(item)
  }
  return { ids: [...new Set(ids)], values }
}
