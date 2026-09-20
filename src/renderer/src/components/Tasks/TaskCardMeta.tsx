import type { TaskProject, TaskRecord, TaskSelectField } from '../../../../shared/tasks'
import { formatTaskDue, isOverdue, PRIORITY_LABELS, RECURRENCE_LABELS } from '../../../../shared/tasks'

export default function TaskCardMeta({ task, projects, fields, showAllFields = false }: { task: TaskRecord; projects: TaskProject[]; fields: TaskSelectField[]; showAllFields?: boolean }) {
  const project = projects.find(item => item.id === task.projectId)
  const values = fields.flatMap(field => {
    const option = field.options.find(item => item.id === task.customFields[field.id])
    return option ? [`${field.name}：${option.name}`] : []
  })
  return <span className="task-card-meta">
    <span className="task-card-properties">
      <span className={`task-card-priority task-card-priority-${task.priority}`}>{PRIORITY_LABELS[task.priority]}优先级</span>
      {project && <span className="task-card-project" title={`清单：${project.name}`}>清单：{project.name}</span>}
      {task.recurrence !== 'none' && <span className="task-card-detail">{RECURRENCE_LABELS[task.recurrence]}</span>}
      {task.remindAt !== null && <span className="task-card-detail">{task.remindFiredAt !== null ? '已提醒' : '有提醒'}</span>}
    </span>
    {values.length > 0 && <span className="tasks-board-card-chips task-card-fields">
      {(showAllFields ? values : values.slice(0, 2)).map(value => <span key={value} className="tasks-chip" title={value}>{value}</span>)}
      {!showAllFields && values.length > 2 && <span className="tasks-chip" title={values.slice(2).join('\n')}>+{values.length - 2}</span>}
    </span>}
  </span>
}

export function TaskCardDue({ task }: { task: TaskRecord }) {
  if (task.dueAt === null) return null
  const date = new Date(task.dueAt)
  const now = new Date()
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const sameDay = (other: Date) => date.toDateString() === other.toDateString()
  const label = sameDay(now) ? '今天' : sameDay(tomorrow) ? '明天' : date.toLocaleDateString('zh-CN', { ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}), month: 'numeric', day: 'numeric' })
  return <span className={`task-card-due${isOverdue(task, now.getTime()) ? ' tasks-overdue' : ''}`} title={`截止时间：${formatTaskDue(task.dueAt)}`}>
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2" y="3.5" width="12" height="11" rx="2" stroke="currentColor" /><path d="M5 1.5v4m6-4v4M2 7h12" stroke="currentColor" /></svg>
    {isOverdue(task, now.getTime()) ? '已逾期 · ' : ''}{label} {date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}
  </span>
}
