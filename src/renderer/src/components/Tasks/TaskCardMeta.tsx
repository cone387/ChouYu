import type { EditableTaskField } from './TaskFieldEditor'
import TaskCardChecklist from './TaskCardChecklist'
import { repeatDescription } from '../../../../shared/taskScheduling'
import type { TaskProject, TaskRecord, TaskSelectField, TaskSource } from '../../../../shared/tasks'
import { formatTaskDue, isOverdue, PRIORITY_LABELS } from '../../../../shared/tasks'

export default function TaskCardMeta({ task, projects, fields, showAllFields = false, onEditField, onOpenProject, onSource }: { task: TaskRecord; projects: TaskProject[]; fields: TaskSelectField[]; showAllFields?: boolean; onEditField?: (task: TaskRecord, field: EditableTaskField) => void; onOpenProject: (id: string) => void; onSource?: (source: TaskSource) => void }) {
  const now = new Date()
  const project = projects.find(item => item.id === task.projectId)
  const values = fields.flatMap(field => {
    const option = field.options.find(item => item.id === task.customFields[field.id])
    return option ? [`${field.name}：${option.name}`] : []
  })
  const overdueItems = task.checklist?.filter(item => !item.done && item.dueAt != null && item.dueAt < now.getTime()) ?? []
  return <span className="task-card-meta">
    <span className="task-card-properties">
      <button type="button" className={`task-card-priority task-card-priority-${task.priority} tasks-card-field-button`} aria-label={`修改 ${task.title} 的优先级`} onClick={() => onEditField?.(task, 'priority')}>{PRIORITY_LABELS[task.priority]}优先级</button>
      {project && <button type="button" className="task-card-project" title={project.name} aria-label={`打开清单 ${project.name}`} onClick={() => onOpenProject(project.id)}>{project.name}</button>}
      {task.recurrence !== 'none' && <span className="task-card-detail">{repeatDescription(task.recurrence, task.repeatRule)}</span>}
      {task.remindAt !== null && <span className="task-card-detail">{task.remindFiredAt !== null ? '已提醒' : '有提醒'}</span>}
      {!!overdueItems.length && <span className="task-card-detail tasks-subitem-overdue" title={overdueItems.map(item => item.title).join('、')}>{overdueItems.length} 个子项过期</span>}
      {task.source && onSource && <button type="button" className="task-card-project" title={task.source.label} onClick={() => onSource(task.source!)}>回看来源</button>}
    </span>
    {values.length > 0 && <span className="tasks-board-card-chips task-card-fields">
      {(showAllFields ? values : values.slice(0, 2)).map(value => <span key={value} className="tasks-chip" title={value}>{value}</span>)}
      {!showAllFields && values.length > 2 && <span className="tasks-chip" title={values.slice(2).join('\n')}>+{values.length - 2}</span>}
    </span>}
    <TaskCardChecklist task={task} />
  </span>
}

export function TaskCardDue({ task, onEditField }: { task: TaskRecord; onEditField?: (task: TaskRecord, field: EditableTaskField) => void }) {
  if (task.dueAt === null) return onEditField ? <button type="button" className="tasks-card-field-button task-card-due" aria-label={`设置 ${task.title} 的截止时间`} onClick={() => onEditField(task, 'dueAt')}>设置截止时间</button> : null
  const date = new Date(task.dueAt)
  const now = new Date()
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const sameDay = (other: Date) => date.toDateString() === other.toDateString()
  const label = sameDay(now) ? '今天' : sameDay(tomorrow) ? '明天' : date.toLocaleDateString('zh-CN', { ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}), month: 'numeric', day: 'numeric' })
  return <button type="button" onClick={() => onEditField?.(task, 'dueAt')} aria-label={`修改 ${task.title} 的截止时间`} className={`tasks-card-field-button task-card-due${isOverdue(task, now.getTime()) ? ' tasks-overdue' : ''}`} title={`截止时间：${formatTaskDue(task.dueAt)}`}>
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2" y="3.5" width="12" height="11" rx="2" stroke="currentColor" /><path d="M5 1.5v4m6-4v4M2 7h12" stroke="currentColor" /></svg>
    {isOverdue(task, now.getTime()) ? '已逾期 · ' : ''}{label} {date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}
  </button>
}
