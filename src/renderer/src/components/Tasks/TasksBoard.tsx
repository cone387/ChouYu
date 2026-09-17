import type { DragEvent } from 'react'
import type { TaskPriority, TaskProject, TaskRecord, TaskSelectField, TaskUpdateInput } from '../../../../shared/tasks'
import { PRIORITY_LABELS } from '../../../../shared/tasks'
import TaskCardMeta, { TaskCardDue } from './TaskCardMeta'

export type BoardGroupMode = 'priority' | 'project' | 'field'

interface BoardColumn {
  key: string
  label: string
  patch: TaskUpdateInput
  archived?: boolean
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
    for (const project of projects.filter(project => !project.archivedAt || tasks.some(task => task.projectId === project.id))) {
      columns.push({ key: project.id, label: `${project.name}${project.archivedAt ? '（已归档）' : ''}`, patch: { projectId: project.id }, archived: Boolean(project.archivedAt) })
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
    if (column.archived) return
    const id = event.dataTransfer.getData('text/plain')
    const task = id ? tasks.find(item => item.id === id) : undefined
    if (!task || columnOf(task) === column) return
    onMove(task.id, column.patch)
  }

  return <div className="tasks-board" aria-label="任务看板">
    {columns.map(column => {
      const items = tasks.filter(task => columnOf(task) === column)
      return <section key={column.key || 'none'} className="tasks-board-column" aria-label={`${column.label}，${items.length} 个任务`}
        onDragOver={event => { if (!column.archived) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }}
        onDrop={event => dropInto(event, column)}>
        <h3 className="tasks-board-column-title">{column.label}<span className="tasks-count">{items.length}</span></h3>
        <ul role="list" className="tasks-board-cards">
          {items.map(task => {
            return <li key={task.id} className="tasks-board-card" draggable data-priority={task.priority}
              onDragStart={event => { event.dataTransfer.setData('text/plain', task.id); event.dataTransfer.effectAllowed = 'move' }}>
              <button type="button" className="tasks-complete" aria-label={`完成 ${task.title}`} onClick={() => onComplete(task.id)} />
              <button type="button" className="tasks-board-card-body" onClick={() => onEdit(task)}>
                <span className="tasks-board-card-head">

                  <span className="tasks-board-card-title">{task.title}</span>
                </span>
                {task.note && <span className="tasks-board-card-note">{task.note}</span>}
                <span className="tasks-board-card-chips"><TaskCardMeta task={task} projects={projects} fields={fields} /></span>
                <span className="tasks-board-card-footer"><span className="tasks-board-card-status"><span className="tasks-board-card-dot" aria-hidden="true" />未完成</span><TaskCardDue task={task} /></span>
              </button>
            </li>
          })}
        </ul>
      </section>
    })}
  </div>
}
