import { useState, type DragEvent } from 'react'
import type { TaskPriority, TaskProject, TaskRecord, TaskSelectField, TaskUpdateInput } from '../../../../shared/tasks'
import TaskIcon from './TaskIcon'
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
  orderScope: string
  tasks: TaskRecord[]
  projects: TaskProject[]
  fields: TaskSelectField[]
  groupingFields: TaskSelectField[]
  hideNote: boolean
  onCreate: (patch: TaskUpdateInput) => void
  onReopen: (id: string) => void
  groupMode: BoardGroupMode
  groupFieldId: string | null
  onEdit: (task: TaskRecord) => void
  onComplete: (id: string) => void
  onMove: (id: string, patch: TaskUpdateInput) => void
}

export function groupTasks(tasks: TaskRecord[], projects: TaskProject[], fields: TaskSelectField[], groupMode: BoardGroupMode, groupFieldId: string | null) {
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
    if (!projects.some(project => project.isDefault)) columns.push({ key: '', label: '无清单', patch: { projectId: null } })
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

  return columns.map(column => ({ ...column, tasks: tasks.filter(task => columnOf(task) === column) }))
}

export default function TasksBoard({ orderScope, tasks, projects, fields, groupingFields, hideNote, groupMode, groupFieldId, onEdit, onComplete, onMove, onCreate, onReopen }: TasksBoardProps) {
  const [dropColumn, setDropColumn] = useState<string | null>(null)
  const [orders, setOrders] = useState<Record<string, string[]>>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem('chouyu:task-board-columns') ?? '{}')
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {}
      return Object.fromEntries(Object.entries(saved).filter(([, value]) => Array.isArray(value) && value.every(key => typeof key === 'string')))
    } catch { return {} }
  })
  const [draggingColumn, setDraggingColumn] = useState<string | null>(null)
  const [columnTarget, setColumnTarget] = useState<{ key: string; after: boolean } | null>(null)
  const scope = JSON.stringify([orderScope, groupMode, groupMode === 'field' ? groupFieldId : null])
  const savedOrder = orders[scope] ?? []
  const columns = groupTasks(tasks, projects, groupingFields, groupMode, groupFieldId).sort((a, b) => {
    const rank = (key: string) => { const index = savedOrder.indexOf(key); return index < 0 ? Infinity : index }
    return rank(a.key) - rank(b.key)
  })
  const moveColumn = (source: string, target: string, after: boolean) => {
    if (source === target || !columns.some(column => column.key === source)) return
    const keys = columns.map(column => column.key).filter(key => key !== source)
    const index = keys.indexOf(target)
    if (index < 0) return
    keys.splice(index + Number(after), 0, source)
    setOrders(current => {
      const next = { ...current, [scope]: keys }
      try { localStorage.setItem('chouyu:task-board-columns', JSON.stringify(next)) } catch { /* Keep the current session usable when storage is unavailable. */ }
      return next
    })
  }
  const finishColumnDrag = () => { setDraggingColumn(null); setColumnTarget(null); setDropColumn(null) }
  const isColumnDrag = (event: DragEvent<HTMLElement>) => event.dataTransfer.types.includes('application/x-chouyu-task-column')

  const dropInto = (event: DragEvent<HTMLElement>, column: BoardColumn) => {
    event.preventDefault()
    if (isColumnDrag(event)) {
      try {
        const payload = JSON.parse(event.dataTransfer.getData('application/x-chouyu-task-column'))
        if (payload.scope === scope && typeof payload.key === 'string') {
          const rect = event.currentTarget.getBoundingClientRect()
          moveColumn(payload.key, column.key, event.clientX > rect.left + rect.width / 2)
        }
      } catch { /* Ignore unrelated drag payloads. */ }
      finishColumnDrag()
      return
    }
    setDropColumn(null)
    if (column.archived) return
    const id = event.dataTransfer.getData('text/plain')
    const task = id ? tasks.find(item => item.id === id) : undefined
    if (!task || columns.find(item => item.tasks.some(record => record.id === task.id))?.key === column.key) return
    onMove(task.id, column.patch)
  }

  return <div className="tasks-board" aria-label="任务看板">
    {columns.map(column => {
      const items = column.tasks
      return <section key={column.key || 'none'} className="tasks-board-column" data-column-key={column.key} data-column-dragging={draggingColumn === column.key || undefined} data-column-insert={columnTarget?.key === column.key ? (columnTarget.after ? 'after' : 'before') : undefined} data-drop-target={dropColumn === column.key || undefined} aria-label={`${column.label}，${items.length} 个任务`}
        onDragOver={event => {
          if (isColumnDrag(event)) {
            event.preventDefault(); event.dataTransfer.dropEffect = 'move'
            const rect = event.currentTarget.getBoundingClientRect()
            setColumnTarget({ key: column.key, after: event.clientX > rect.left + rect.width / 2 })
          } else if (!column.archived) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropColumn(column.key) }
          const board = event.currentTarget.parentElement
          if (board) { const rect = board.getBoundingClientRect(); if (event.clientX > rect.right - 48) board.scrollLeft += 24; else if (event.clientX < rect.left + 48) board.scrollLeft -= 24 }
        }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setDropColumn(null); setColumnTarget(null) } }}
        onDrop={event => dropInto(event, column)}>
        <h3 className="tasks-board-column-title"><button type="button" className="tasks-column-drag-handle" draggable aria-label={`移动看板列 ${column.label}`} title="拖动调整列位置；Alt + 左右方向键也可移动"
          onDragStart={event => { event.stopPropagation(); event.dataTransfer.setData('application/x-chouyu-task-column', JSON.stringify({ scope, key: column.key })); event.dataTransfer.effectAllowed = 'move'; setDraggingColumn(column.key) }}
          onDragEnd={finishColumnDrag}
          onKeyDown={event => {
            if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
            event.preventDefault()
            const index = columns.findIndex(item => item.key === column.key)
            const target = columns[index + (event.key === 'ArrowRight' ? 1 : -1)]
            if (target) moveColumn(column.key, target.key, event.key === 'ArrowRight')
          }}><TaskIcon name="grip" /><span>{column.label}</span><span className="tasks-count">{items.length}</span></button>{!column.archived && <button type="button" className="tasks-column-add" aria-label={`在 ${column.label} 中新建任务`} title="新建任务" onClick={() => onCreate(column.patch)}><TaskIcon name="plus" /></button>}</h3>
        {items.length === 0 && <p className="tasks-board-empty">暂无任务，可拖动任务到这里</p>}
        <ul role="list" className="tasks-board-cards">
          {items.map(task => {
            return <li key={task.id} className="tasks-board-card" onDragEnd={() => setDropColumn(null)} draggable data-priority={task.priority}
              onDragStart={event => { event.dataTransfer.setData('text/plain', task.id); event.dataTransfer.effectAllowed = 'move' }}>
              <button type="button" className="tasks-complete" data-done={task.status === 'done' || undefined} aria-label={`${task.status === 'done' ? '恢复' : '完成'} ${task.title}`} onClick={() => task.status === 'done' ? onReopen(task.id) : onComplete(task.id)}>{task.status === 'done' ? '✓' : ''}</button>
              <button type="button" className="tasks-board-card-body" onClick={() => onEdit(task)}>
                <span className="tasks-board-card-head">

                  <span className="tasks-board-card-title">{task.title}</span>
                </span>
                {!hideNote && task.note && <span className="tasks-board-card-note">{task.note}</span>}
                <span className="tasks-board-card-chips"><TaskCardMeta task={task} projects={projects} fields={fields} /></span>
                <span className="tasks-board-card-footer"><span className="tasks-board-card-status"><span className="tasks-board-card-dot" aria-hidden="true" />{task.status === 'done' ? '已完成' : '未完成'}</span><TaskCardDue task={task} /></span>
              </button>
            </li>
          })}
        </ul>
        {!column.archived && <button type="button" className="tasks-board-add" onClick={() => onCreate(column.patch)}><TaskIcon name="plus" />新建任务</button>}
      </section>
    })}
  </div>
}
