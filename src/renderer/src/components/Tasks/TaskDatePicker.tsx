import type { TaskDraft } from './TaskEditorDialog'
import TaskDateTimePicker from '../common/DateTimePicker'

export default function TaskDatePicker({ draft, busy, onChange }: { draft: TaskDraft; busy: boolean; onChange: (draft: TaskDraft) => void }) {
  return <div className="tasks-schedule-range" role="group" aria-label="时间安排">
    <TaskDateTimePicker label="任务开始时间" triggerLabel="开始" placeholder="未设置" disabled={busy} value={draft.startDate ? `${draft.startDate}T${draft.startTime}` : ''} onChange={value => {
      const [startDate, startTime = draft.startTime] = value.split('T')
      onChange({ ...draft, startDate, startTime })
    }} />
    <span aria-hidden="true">—</span>
    <TaskDateTimePicker label="任务截止时间" triggerLabel="截止" placeholder="未设置" disabled={busy} value={draft.dueDate ? `${draft.dueDate}T${draft.dueTime}` : ''} onChange={value => {
      const [dueDate, dueTime = draft.dueTime] = value.split('T')
      onChange({ ...draft, dueDate, dueTime, ...(dueDate ? {} : { recurrence: 'none' as const, repeatRule: null, remind: 'none' as const, reminderOffsets: [], reminderTimes: [] }) })
    }} />
  </div>
}
