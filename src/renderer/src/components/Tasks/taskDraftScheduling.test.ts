import { expect, test } from 'vitest'
import type { TaskRecord } from '../../../../shared/tasks'
import type { TaskDraft } from './TaskEditorDialog'
import { draftDueAt, draftReminderTimes, draftScheduleFromTask } from './taskDraftScheduling'
test('editing a title preserves arbitrary reminders and sub-minute due precision', () => {
  const dueAt = new Date(2026, 8, 21, 23, 59, 59, 999).getTime()
  const task = { dueAt, remindAt: dueAt - 123456, reminders: [{ at: dueAt - 123456, firedAt: null }] } as TaskRecord
  const draft = { dueDate: '2026-09-21', dueTime: '23:59', originalDueAt: dueAt, ...draftScheduleFromTask(task) } as TaskDraft
  expect(draftDueAt(draft)).toBe(dueAt)
  expect(draftReminderTimes(draft)).toEqual([dueAt - 123456])
  expect(draftReminderTimes({ ...draft, dueDate: '2026-09-22' })).toEqual([new Date(2026, 8, 22, 23, 59).getTime() - 123456])
})
test('independent reminder without a due date survives editing', () => {
  const task = { dueAt: null, remindAt: 1000 } as TaskRecord
  expect(draftReminderTimes({ dueDate: '', ...draftScheduleFromTask(task) } as TaskDraft)).toEqual([1000])
})
