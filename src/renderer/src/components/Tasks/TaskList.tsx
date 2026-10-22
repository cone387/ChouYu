import { useState, useEffect, type Dispatch, type SetStateAction, type MutableRefObject, type ReactNode } from 'react'
import type { TaskRecord, TaskProject, TaskSelectField, TaskSource } from '../../../../shared/tasks'
import type { TaskSelection as Selection } from './taskData'
import type useTaskLayoutOrder from './useTaskLayoutOrder'
import type { BoardGroupMode } from './TasksBoard'
import type { BoardColumn } from './taskGrouping'
import type { EditableTaskField } from './TaskFieldEditor'
import TaskCardMeta, { TaskCardDue } from './TaskCardMeta'
import TaskIcon from './TaskIcon'
interface TaskListModel {
  listGrouped: boolean
  listColumns: (BoardColumn & { tasks: TaskRecord[]; totalCount: number })[]
  listTasks: TaskRecord[]
  selection: Selection
  columnOrderScope: string
  columnIds: string[]
  layoutOrder: ReturnType<typeof useTaskLayoutOrder>
  boardGroupMode: BoardGroupMode
  groupFieldId: string | null
  collapsedGroups: Record<string, boolean>
  setCollapsedGroups: Dispatch<SetStateAction<Record<string, boolean>>>
  focusTaskId?: string
  taskRefs: MutableRefObject<Record<string, HTMLLIElement | null>>
  actionPending: boolean
  complete(id: string): void
  reopen(id: string): void
  remove(id: string): Promise<void>
  onEdit(task: TaskRecord): void
  hiddenFields: string[]
  projects: TaskProject[]
  displayFields: TaskSelectField[]
  editField(task: TaskRecord, field: EditableTaskField): void
  openProject(id: string): void
  setSourcePreview(source: TaskSource | null): void
  canMoveToColumn(id: string, column: BoardColumn): boolean
  canReorderListTask(id: string, target: string): boolean
  moveListTask(id: string, target: string | null, after: boolean, groupId?: string): void
  taskGroupKey(id: string): string | undefined
  renameDisplayGroup(id: string): void
  renderDisplayGroupActions(id: string): ReactNode
}
const dueLabel = (at: number): string =>
  new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(at)

/** List presentation and drag feedback; all mutations are single-task callbacks. */
export default function TaskList({ model }: { model: TaskListModel }) {
  const { listGrouped, listColumns, listTasks, selection, columnOrderScope, columnIds, layoutOrder, boardGroupMode, groupFieldId, collapsedGroups, setCollapsedGroups, focusTaskId, taskRefs, actionPending, complete, reopen, remove, hiddenFields, projects, displayFields, editField, openProject, setSourcePreview, canMoveToColumn, canReorderListTask, moveListTask, taskGroupKey, renameDisplayGroup, renderDisplayGroupActions, onEdit } = model
  const [listDraggingTask, setListDraggingTask] = useState<string | null>(null)
  const [listCardTarget, setListCardTarget] = useState<{ id: string; after: boolean } | null>(null)
  const [listDropGroup, setListDropGroup] = useState<string | null>(null)
  const finishListDrag = () => { setListDraggingTask(null); setListCardTarget(null); setListDropGroup(null) }
  useEffect(finishListDrag, [selection, listGrouped, boardGroupMode, groupFieldId])
  const renderTask = (task: TaskRecord) => {
    return <li key={task.id} data-task-id={task.id} ref={element => { taskRefs.current[task.id] = element }} tabIndex={0} aria-label={`任务：${task.title}，按 Enter 编辑`} className={`tasks-item${task.id === focusTaskId ? ' tasks-item-focused' : ''}`} data-priority={task.priority} data-completed={task.status === 'done' || undefined}
          draggable={true}
          data-card-insert={listCardTarget?.id === task.id ? (listCardTarget.after ? 'after' : 'before') : undefined}
          onDragStart={event => { event.stopPropagation(); event.dataTransfer.setData('application/x-chouyu-list-task', task.id); event.dataTransfer.effectAllowed = 'move'; setListDraggingTask(task.id) }}
          onDragEnd={finishListDrag}
          onDragOver={event => {
            if (!event.dataTransfer.types.includes('application/x-chouyu-list-task')) return
            event.stopPropagation()
            if (!listDraggingTask || !canReorderListTask(listDraggingTask, task.id)) return
            event.preventDefault(); event.dataTransfer.dropEffect = 'move'
            const rect = event.currentTarget.getBoundingClientRect()
            const after = event.clientY > rect.top + rect.height / 2
            setListDropGroup(null)
            setListCardTarget(current => current?.id === task.id && current.after === after ? current : { id: task.id, after })
          }}
          onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setListCardTarget(null) }}
          onDrop={event => {
            if (!event.dataTransfer.types.includes('application/x-chouyu-list-task')) return
            event.preventDefault(); event.stopPropagation()
            const id = event.dataTransfer.getData('application/x-chouyu-list-task')
            if (canReorderListTask(id, task.id)) {
              const rect = event.currentTarget.getBoundingClientRect()
              moveListTask(id, task.id, event.clientY > rect.top + rect.height / 2, taskGroupKey(task.id))
            }
            finishListDrag()
          }}
          onClick={event => {
            if ((event.target as Element).closest('button, .tasks-item-menu, a, input, select, textarea, [role="button"]') || window.getSelection()?.toString()) return
            event.currentTarget.focus({ preventScroll: true })
            onEdit(task)
          }}
          onKeyDown={event => {
            if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return
            event.preventDefault(); onEdit(task)
          }}>
          <button type="button" className="tasks-complete" disabled={actionPending} data-done={task.status === 'done' || undefined} aria-label={`${task.status === 'done' ? '恢复' : '完成'} ${task.title}`} onClick={() => task.status === 'done' ? reopen(task.id) : complete(task.id)}></button>
          <div className="tasks-item-body">
            <div className="tasks-item-head">
              <button type="button" className="tasks-item-title tasks-title-button" onClick={() => onEdit(task)}>{task.title}</button>
            </div>
            {!hiddenFields.includes('note') && task.note && <p className="tasks-item-note" title={task.note}>{task.note}</p>}
            <TaskCardMeta onEditField={editField} task={task} projects={projects} fields={displayFields} onOpenProject={openProject} onSource={setSourcePreview} showAllFields />
            <div className="tasks-card-schedule">
              {!hiddenFields.includes('start') && task.startAt != null && <span className="tasks-start-cell"><TaskIcon name="today" /><span>开始 <time dateTime={new Date(task.startAt).toISOString()}>{dueLabel(task.startAt)}</time></span></span>}
              {!hiddenFields.includes('due') && <span className="tasks-due-cell"><span>截止</span><TaskCardDue task={task} onEditField={editField} /></span>}
              {task.startAt == null && task.dueAt === null && task.status === 'open' && (!hiddenFields.includes('start') || !hiddenFields.includes('due')) && <span className="tasks-card-unplanned"><TaskIcon name="unplanned" />待规划 · 未安排时间</span>}
              {task.status === 'done' && <span className="tasks-card-completed">已完成{task.completedAt ? ` · ${dueLabel(task.completedAt)}` : ''}</span>}
            </div>
          </div>
              <details className="tasks-item-menu">
                <summary aria-label={`更多操作 ${task.title}`} title="更多操作"><TaskIcon name="more" /></summary>
                <div className="tasks-item-menu-popover">
                  <button type="button" onClick={() => onEdit(task)}>编辑任务</button>
                  <button type="button" className="tasks-item-menu-danger" onClick={() => remove(task.id)}>删除任务</button>
                </div>
              </details>
        </li>
  }

  return (listGrouped
        ? <div className="tasks-grouped-list">{listColumns.map(column => <div className="tasks-content-group-shell" key={column.key || 'none'} data-drop-target={listDropGroup === column.key || undefined}
            onDragOver={event => { if (listDraggingTask && canMoveToColumn(listDraggingTask, column) && event.dataTransfer.types.includes('application/x-chouyu-list-task')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setListDropGroup(column.key) } }}
            onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setListDropGroup(null) }}
            onDrop={event => {
              finishListDrag()
              const id = event.dataTransfer.getData('application/x-chouyu-list-task')
              if (!canMoveToColumn(id, column)) return
              event.preventDefault()
              moveListTask(id, null, true, column.key)
            }}>
          <details className="tasks-content-group" data-group-key={column.key}
            open={!(collapsedGroups[`${columnOrderScope}:${column.key}`] ?? (boardGroupMode === 'status' && column.key === 'done'))}
            onToggle={event => {
              const collapsed = !event.currentTarget.open, key = `${columnOrderScope}:${column.key}`
              setCollapsedGroups(current => current[key] === collapsed ? current : { ...current, [key]: collapsed })
            }}>
            <summary {...layoutOrder.handle(columnOrderScope, column.key, columnIds)} {...layoutOrder.drop(columnOrderScope, column.key, columnIds)}><TaskIcon name="chevron" /><span title={boardGroupMode === 'custom' && column.key ? '双击修改分组名称' : undefined} onDoubleClick={event => { event.stopPropagation(); renameDisplayGroup(column.key) }}>{column.label}</span><span className="tasks-count">{column.totalCount}</span></summary>
            <ul role="list" className={`tasks-list${selection === 'done' ? ' tasks-list-done' : ''}`} aria-label={column.label}>{column.tasks.map(renderTask)}</ul>
            {column.totalCount > column.tasks.length && <p className="tasks-view-description">已加载 {column.tasks.length} / {column.totalCount}，可在底部加载更多。</p>}
          </details>{renderDisplayGroupActions(column.key)}</div>)}
          </div>
        : <ul role="list" className={`tasks-list${selection === 'done' ? ' tasks-list-done' : ''}`} aria-label={selection === 'done' ? '已完成任务' : '任务列表'}>
        {listTasks.map(renderTask)}
      </ul>)
}
