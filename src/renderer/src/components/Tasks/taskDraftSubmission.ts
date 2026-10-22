import type { TaskRecord, TaskSelectField, TasksAPI, RemindChoiceId } from '../../../../shared/tasks'
import { REMIND_CHOICES, remindAtFromChoice } from '../../../../shared/tasks'
import { repeatRuleFor, validateReminderTimes } from '../../../../shared/taskScheduling'
import { draftDueAt, draftReminderTimes, draftScheduleFromTask } from './taskDraftScheduling'
import type { TaskDraft as Draft } from './TaskEditorDialog'
export const emptyDraft: Draft = { id: '', title: '', note: '', projectId: '', priority: 'medium', startDate: '', startTime: '09:00', dueDate: '', dueTime: '09:00', remind: 'due', recurrence: 'none', customFields: {} }
export const toInputDate = (at: number): string => {
  const date = new Date(at)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const remindChoiceFromTask = (task: TaskRecord): RemindChoiceId => {
  if (task.remindAt === null || task.dueAt === null) return 'none'
  for (const choice of REMIND_CHOICES) {
    if (remindAtFromChoice(choice.id, task.dueAt) === task.remindAt) return choice.id
  }
  return 'none'
}
export const draftFromTask = (task: TaskRecord): Draft => ({
  id: task.id,
  ...draftScheduleFromTask(task), originalDueAt: task.dueAt, originalStartAt: task.startAt, recurrenceIndex: task.recurrenceIndex, recurrenceAnchorAt: task.recurrenceAnchorAt,
  title: task.title,
  note: task.note,
  projectId: task.projectId ?? '',
  priority: task.priority,
  startDate: task.startAt != null ? toInputDate(task.startAt) : '',
  startTime: task.startAt != null ? new Date(task.startAt).toTimeString().slice(0, 5) : '09:00',
  dueDate: task.dueAt ? toInputDate(task.dueAt) : '',
  dueTime: task.dueAt ? new Date(task.dueAt).toTimeString().slice(0, 5) : '09:00',
  remind: remindChoiceFromTask(task), recurrence: task.recurrence, customFields: { ...task.customFields }, checklist: task.checklist ?? [], source: task.source
})

export async function saveTaskDraft(draft: Draft, fields: TaskSelectField[], api: Pick<TasksAPI, 'create' | 'update'>): Promise<TaskRecord> {
    const title = draft.title.trim()
    if (!title) throw new Error('任务标题不能为空。')
    if (!draft.projectId) throw new Error('请先选择或创建所属清单。')
    let startAt = draft.startDate ? new Date(`${draft.startDate}T${draft.startTime || '09:00'}`).getTime() : null
    if (startAt !== null && draft.originalStartAt != null && Math.floor(startAt / 60000) === Math.floor(draft.originalStartAt / 60000)) startAt = draft.originalStartAt
    const dueAt = draftDueAt(draft)
    if (startAt !== null && dueAt !== null && startAt > dueAt) throw new Error('开始时间不能晚于截止时间。')
    let reminderTimes: number[]
    try { reminderTimes = validateReminderTimes(draftReminderTimes(draft)); repeatRuleFor(draft.recurrence, draft.repeatRule) }
    catch (error) { throw error }
    const repeatRule = draft.recurrence === 'custom' ? draft.repeatRule : null
    const remindAt = reminderTimes[0] ?? null
    const customFields = Object.fromEntries(fields.map(field => [field.id, draft.customFields[field.id] ?? null]))
  const input = { title, note: draft.note, projectId: draft.projectId || null, priority: draft.priority, startAt, dueAt, remindAt, reminderTimes, repeatRule, recurrence: draft.recurrence, customFields, checklist: draft.checklist?.filter(item => item.title.trim()), source: draft.source }
  return draft.id ? api.update(draft.id, input) : api.create(input)
}
