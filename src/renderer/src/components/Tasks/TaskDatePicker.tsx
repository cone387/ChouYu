import { useState } from 'react'
import type { TaskDraft } from './TaskEditorDialog'
import TaskScheduleSettings from './TaskScheduleSettings'
import TaskIcon from './TaskIcon'

const dateValue = (day: Date) => `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`

export default function TaskDatePicker({ draft, busy, onChange }: { draft: TaskDraft; busy: boolean; onChange: (draft: TaskDraft) => void }) {
  const [month, setMonth] = useState(() => new Date((draft.dueDate || draft.startDate || dateValue(new Date())) + 'T12:00:00'))
  const [target, setTarget] = useState<'startDate' | 'dueDate'>('dueDate')
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const offset = (first.getDay() + 6) % 7
  const days = Array.from({ length: 42 }, (_, index) => new Date(first.getFullYear(), first.getMonth(), index - offset + 1))
  const today = dateValue(new Date())
  const setQuickDate = (offset: number) => {
    const day = new Date(); day.setDate(day.getDate() + offset)
    onChange({ ...draft, dueDate: dateValue(day) }); setMonth(day)
  }
  const summary = draft.dueDate ? `${draft.startDate ? draft.startDate + ' → ' : ''}${draft.dueDate} ${draft.dueTime} 截止` : draft.startDate ? `${draft.startDate} ${draft.startTime} 开始` : '其他时间'
  return <div className="tasks-date-shortcuts" role="group" aria-label="快捷截止日期">
    {!draft.dueDate && !draft.startDate && <><button type="button" disabled={busy} onClick={() => setQuickDate(0)}><TaskIcon name="today" />今天</button><button type="button" disabled={busy} onClick={() => setQuickDate(1)}><TaskIcon name="today" />明天</button></>}
    <details className="tasks-tool-menu tasks-composer-dates">
      <summary aria-label="设置任务时间" aria-disabled={busy} onClick={event => { if (busy) event.preventDefault() }}><TaskIcon name="clock" /><span>{summary}</span><TaskIcon name="chevron" /></summary>
      <div className="tasks-item-menu-popover tasks-date-popover" role="group" aria-label="任务时间设置">
        <header className="tasks-calendar-header">
          <span>{month.getFullYear()} 年 {month.getMonth() + 1} 月</span>
          <button type="button" data-menu-keep-open aria-label="上个月" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</button>
          <button type="button" data-menu-keep-open aria-label="下个月" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</button>
        </header>
        <div className="tasks-calendar-week" aria-hidden="true">{['一', '二', '三', '四', '五', '六', '日'].map(day => <span key={day}>{day}</span>)}</div>
        <div className="tasks-calendar-days" role="group" aria-label={target === 'startDate' ? '选择开始日期' : '选择截止日期'}>
          {days.map(day => {
            const value = dateValue(day)
            return <button type="button" data-menu-keep-open key={value} aria-label={value} aria-pressed={draft[target] === value} aria-current={value === today ? 'date' : undefined} data-outside={day.getMonth() !== month.getMonth() || undefined} onClick={() => onChange({ ...draft, [target]: value })}>{day.getDate()}</button>
          })}
        </div>
        <div className="tasks-calendar-date-row" data-active={target === 'startDate' || undefined}>
          <label>开始<input type="date" aria-label="任务开始日期" value={draft.startDate} onFocus={() => setTarget('startDate')} onChange={event => onChange({ ...draft, startDate: event.target.value })} /></label>
          <input type="time" aria-label="任务开始时间" value={draft.startTime} disabled={!draft.startDate} onChange={event => onChange({ ...draft, startTime: event.target.value })} />
        </div>
        <div className="tasks-calendar-date-row" data-active={target === 'dueDate' || undefined}>
          <label>截止<input type="date" aria-label="任务截止日期" value={draft.dueDate} onFocus={() => setTarget('dueDate')} onChange={event => onChange({ ...draft, dueDate: event.target.value, ...(event.target.value ? {} : { recurrence: 'none', repeatRule: null, remind: 'none', reminderOffsets: [], reminderTimes: [] }) })} /></label>
          <input type="time" aria-label="任务截止时间" value={draft.dueTime} disabled={!draft.dueDate} onChange={event => onChange({ ...draft, dueTime: event.target.value })} />
        </div>
        <TaskScheduleSettings draft={draft} busy={busy} onChange={onChange} />
        <footer className="tasks-calendar-footer"><button type="button" data-menu-keep-open onClick={() => onChange({ ...draft, startDate: '', dueDate: '', remind: 'none', recurrence: 'none', repeatRule: null, reminderOffsets: [], reminderTimes: [] })}>清除时间</button><button type="button">完成</button></footer>
      </div>
    </details>
  </div>
}
