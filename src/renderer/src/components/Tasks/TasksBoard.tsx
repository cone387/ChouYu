import type { DragEvent } from 'react'
import type { TaskPriority, TaskProject, TaskRecord, TaskSelectField, TaskUpdateInput } from '../../../../shared/tasks'
import { PRIORITY_LABELS, formatTaskDue, isOverdue } from '../../../../shared/tasks'

export type BoardGroupMode = 'priority' | 'project' | 'field'

interface BoardColumn {
  key: string
  label: string
  patch: TaskUpdateInput
}

interface TasksBoardProps {
  tasks: TaskRecord[]
  projects: TaskProject[]
  fields: TaskSelectField[]
  groupMode: BoardGroupMode
  groupFieldId: string | null
  onEdit: (task: TaskRecord) => void
  onComplete: (id: string) => void
  onMove: (id: string, patch: TaskUpdateInput) => void
}

export default function TasksBoard({ tasks, projects, fields, groupMode, groupFieldId, onEdit, onComplete, onMove }: TasksBoardProps) {
  const groupField = groupMode === 'field' ? fields.find(field => field.id === groupFieldId) ?? null : null

  const columns: BoardColumn[] = []
  if (groupMode === 'priority') {
    for (const priority of ['high', 'medium', 'low'] as TaskPriority[]) {
      columns.push({ key: priority, label: `${PRIORITY_LABELS[priority]}优先级`, patch: { priority } })
    }
  } else if (groupMode === 'project') {
    for (const project of projects.filter(project => !project.archivedAt)) {
      columns.push({ key: project.id, label: project.name, patch: { projectId: project.id } })
    }
    columns.push({ key: '', label: '无项目', patch: { projectId: null } })
  } else if (groupField) {
    for (const option of groupField.options) {
      columns.push({ key: option.id, label: option.name, patch: { customFields: { [groupField.id]: option.id } } })
    }
    columns.push({ key: '', label: '未设置', patch: { customFields: { [groupField.id]: null } } })
  }

  const columnOf = (task: TaskRecord): BoardColumn | undefined => {
    if (groupMode === 'priority') return columns.find(column => column.key === task.priority)
    if (groupMode === 'project') return columns.find(column => column.key === (task.projectId ?? ''))
    if (!groupField) return undefined
    return columns.find(column => column.key === (task.customFields[groupField.id] ?? ''))
  }

  const dropInto = (event: DragEvent<HTMLElement>, column: BoardColumn) => {
    event.preventDefault()
    const id = event.dataTransfer.getData('text/plain')
    const task = id ? tasks.find(item => item.id === id) : undefined
    if (!task || columnOf(task) === column) return
    onMove(task.id, column.patch)
  }

  return <div className="tasks-board" aria-label="任务看板">
    {columns.map(column => {
      const items = tasks.filter(task => columnOf(task) === column)
      return <section key={column.key || 'none'} className="tasks-board-column" aria-label={`${column.label}，${items.length} 个任务`}
        onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }}
        onDrop={event => dropInto(event, column)}>
        <h3 className="tasks-board-column-title">{column.label}<span className="tasks-count">{items.length}</span></h3>
        <ul role="list" className="tasks-board-cards">
          {items.map(task => <li key={task.id} className="tasks-board-card" draggable data-priority={task.priority}
            onDragStart={event => { event.dataTransfer.setData('text/plain', task.id); event.dataTransfer.effectAllowed = 'move' }}>
            <button type="button" className="tasks-complete" aria-label={`完成 ${task.title}`} onClick={() => onComplete(task.id)} />
            <button type="button" className="tasks-board-card-body" onClick={() => onEdit(task)}>
              <span className="tasks-board-card-title">{task.title}</span>
              {task.dueAt !== null && <span className={`tasks-board-card-due${isOverdue(task, Date.now()) ? ' tasks-overdue' : ''}`}>{formatTaskDue(task.dueAt)}</span>}
            </button>
          </li>)}
        </ul>
      </section>
    })}
  </div>
}
