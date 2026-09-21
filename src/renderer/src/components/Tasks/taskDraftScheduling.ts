import { remindAtFromChoice, type TaskRecord } from '../../../../shared/tasks'
import type { TaskDraft } from './TaskEditorDialog'

export function draftDueAt(draft: Pick<TaskDraft, 'dueDate' | 'dueTime' | 'originalDueAt'>): number | null {
  if (draft.originalDueAt != null) {
    const original = new Date(draft.originalDueAt), entered = new Date(`${draft.dueDate}T${draft.dueTime || '09:00'}`)
    if (Math.floor(original.getTime() / 60000) === Math.floor(entered.getTime() / 60000)) return draft.originalDueAt
  }
  return draft.dueDate ? new Date(`${draft.dueDate}T${draft.dueTime || '09:00'}`).getTime() : null
}

export function draftReminderTimes(draft: TaskDraft): number[] {
  const due = draftDueAt(draft)
  const absolute = draft.reminderTimes ?? []
  const offsets = draft.reminderOffsets
  const relative = due === null ? [] : offsets !== undefined ? offsets.map(offset => due - offset) : [remindAtFromChoice(draft.remind, due)].filter((at): at is number => at !== null)
  return [...new Set([...absolute, ...relative])].sort((a, b) => a - b)
}

export function draftScheduleFromTask(task: TaskRecord): Pick<TaskDraft, 'reminderTimes' | 'reminderOffsets' | 'repeatRule'> {
  const times = task.reminders?.map(r => r.at) ?? (task.remindAt === null ? [] : [task.remindAt])
  return { reminderTimes: task.dueAt === null ? times : [], reminderOffsets: task.dueAt === null ? [] : times.map(at => task.dueAt! - at), repeatRule: task.repeatRule ?? null }
}
