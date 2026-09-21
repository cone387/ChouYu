import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { TaskProject, TaskRecord, TaskSelectField, TaskUpdateInput, TaskSortMode } from '../../../../shared/tasks'
import TaskIcon from './TaskIcon'
import TaskQuickEdit from './TaskQuickEdit'
import type { TaskSource } from '../../../../shared/tasks'
import { formatTaskDue, sortTasks } from '../../../../shared/tasks'
import TaskCardMeta, { TaskCardDue } from './TaskCardMeta'
import type { TaskDisplayGroup } from './taskViewPreferences'

import { groupTasks, taskGroupMove, type BoardColumn, type BoardGroupMode } from './taskGrouping'
export { groupTasks, type BoardGroupMode } from './taskGrouping'

interface TasksBoardProps {
  weekPeriod?: 'week' | 'nextWeek'
  onSource?: (source: TaskSource) => void
  onQuickEdit?: (id: string, patch: TaskUpdateInput) => Promise<unknown>
  orderScope: string
  tasks: TaskRecord[]
  projects: TaskProject[]
  fields: TaskSelectField[]
  groupingFields: TaskSelectField[]
  customGroups: TaskDisplayGroup[]
  renderGroupActions: (id: string) => ReactNode
  onRenameGroup: (id: string) => void
  onNewGroup: () => void
  savedOrder: string[]
  onOrder: (keys: string[]) => void
  hideNote: boolean
  onCreate: (patch: TaskUpdateInput, groupId: string) => void
  onReopen: (id: string) => void
  groupMode: BoardGroupMode
  sortMode: TaskSortMode
  doneCounts?: Record<string, number>
  groupFieldId: string | null
  onOpenProject: (id: string) => void
  onEdit: (task: TaskRecord) => void
  onComplete: (id: string) => void
  onMove: (id: string, patch: TaskUpdateInput, targetId: string | null, after: boolean, groupId?: string) => Promise<void>
}

export default function TasksBoard({ weekPeriod = 'week', onSource, onQuickEdit, orderScope, tasks, projects, fields, groupingFields, customGroups, renderGroupActions, onRenameGroup, onNewGroup, savedOrder, onOrder, hideNote, groupMode, sortMode, doneCounts, groupFieldId, onOpenProject, onEdit, onComplete, onMove, onCreate, onReopen }: TasksBoardProps) {
  const boardRef = useRef<HTMLDivElement>(null)
  const positions = useRef(new Map<string, DOMRect>())
  const scrollFrame = useRef<number | null>(null)
  const scrollSpeed = useRef(0)
  const dragPreview = useRef<HTMLElement | null>(null)
  const [previewOrder, setPreviewOrder] = useState<string[] | null>(null)
  const previewOrderRef = useRef<string[] | null>(null)
  const [cardTarget, setCardTarget] = useState<{ column: string; id: string | null; after: boolean } | null>(null)
  const [savingTask, setSavingTask] = useState<string | null>(null)
  const savingRef = useRef(false)
  const [moveError, setMoveError] = useState('')
  const [draggingTask, setDraggingTask] = useState<string | null>(null)
  const [dropColumn, setDropColumn] = useState<string | null>(null)
  const [draggingColumn, setDraggingColumn] = useState<string | null>(null)
  const [columnTarget, setColumnTarget] = useState<{ key: string; after: boolean } | null>(null)
  const scope = JSON.stringify([orderScope, groupMode, groupMode === 'field' ? groupFieldId : null])
  const baseColumns = groupTasks(tasks, projects, groupingFields, groupMode, groupFieldId, Date.now(), customGroups, doneCounts, weekPeriod).sort((a, b) => {
    const rank = (key: string) => { const index = savedOrder.indexOf(key); return index < 0 ? Infinity : index }
    return rank(a.key) - rank(b.key)
  }).map(column => groupMode === 'status' && column.key === 'done' && sortMode !== 'manual' ? { ...column, tasks: sortTasks(column.tasks, 'completed', Date.now()) } : column)
  const columns = previewOrder ? [...baseColumns].sort((a, b) => previewOrder.indexOf(a.key) - previewOrder.indexOf(b.key)) : baseColumns
  // Animate layout changes without changing the board's grouping or sort order.
  useLayoutEffect(() => {
    const next = new Map<string, DOMRect>()
    const board = boardRef.current
    if (!board) return
    const elements = Array.from(board.querySelectorAll<HTMLElement>('[data-motion-key]')).filter(element => !element.closest('.tasks-drag-preview'))
    // Read layout without an earlier preview animation's transform applied.
    elements.forEach(element => element.getAnimations().forEach(animation => animation.cancel()))
    elements.forEach(element => {
      if (element.closest('.tasks-drag-preview')) return
      const key = element.dataset.motionKey!
      const bounds = element.getBoundingClientRect()
      const boardBounds = board.getBoundingClientRect()
      const rect = new DOMRect(bounds.left - boardBounds.left + board.scrollLeft, bounds.top - boardBounds.top + board.scrollTop, bounds.width, bounds.height)
      const old = positions.current.get(key)
      next.set(key, rect)
      if (old && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        const parentKey = element.parentElement?.closest<HTMLElement>('[data-column-key]')?.dataset.motionKey
        const oldParent = parentKey ? positions.current.get(parentKey) : undefined
        const newParent = parentKey ? next.get(parentKey) : undefined
        const x = old.left - rect.left - (oldParent && newParent ? oldParent.left - newParent.left : 0)
        const y = old.top - rect.top - (oldParent && newParent ? oldParent.top - newParent.top : 0)
        if (Math.abs(x) > 1 || Math.abs(y) > 1) {
          element.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: 'translate(0, 0)' }], {
            duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)'
          })
        }
      }
    })
    positions.current = next
  }, [tasks, savedOrder, scope, previewOrder])

  const stopScroll = () => {
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current)
    scrollFrame.current = null
    scrollSpeed.current = 0
  }
  const updateScroll = (clientX: number) => {
    const board = boardRef.current
    if (!board) return
    const rect = board.getBoundingClientRect()
    const edge = 56
    scrollSpeed.current = clientX < rect.left + edge
      ? -Math.min(12, Math.max(0, (rect.left + edge - clientX) / edge * 12))
      : Math.min(12, Math.max(0, (clientX - rect.right + edge) / edge * 12))
    if (!scrollSpeed.current) { stopScroll(); return }
    if (scrollFrame.current !== null) return
    const tick = () => {
      board.scrollLeft += scrollSpeed.current
      scrollFrame.current = requestAnimationFrame(tick)
    }
    scrollFrame.current = requestAnimationFrame(tick)
  }
  const setPreview = (event: DragEvent<HTMLElement>, element: HTMLElement) => {
    dragPreview.current?.remove()
    const rect = element.getBoundingClientRect()
    const preview = element.cloneNode(true) as HTMLElement
    preview.classList.add('tasks-drag-preview')
    preview.style.width = `${rect.width}px`
    preview.style.height = `${Math.min(rect.height, 420)}px`
    preview.setAttribute('aria-hidden', 'true')
    boardRef.current?.appendChild(preview)
    dragPreview.current = preview
    event.dataTransfer.setDragImage(preview, Math.max(0, event.clientX - rect.left), Math.max(0, event.clientY - rect.top))
  }
  useEffect(() => () => { stopScroll(); dragPreview.current?.remove() }, [])

  const saveColumnOrder = onOrder
  const orderedKeys = (source: string, target: string, after: boolean) => {
    const keys = baseColumns.map(column => column.key).filter(key => key !== source)
    const index = keys.indexOf(target)
    if (source === target || index < 0 || !baseColumns.some(column => column.key === source)) return null
    keys.splice(index + Number(after), 0, source)
    return keys
  }
  const moveColumn = (source: string, target: string, after: boolean) => {
    const keys = orderedKeys(source, target, after)
    if (keys) saveColumnOrder(keys)
  }
  const finishColumnDrag = () => {
    setDraggingColumn(null); setDraggingTask(null); setColumnTarget(null); setDropColumn(null); setCardTarget(null)
    setPreviewOrder(null); previewOrderRef.current = null
    stopScroll(); dragPreview.current?.remove(); dragPreview.current = null
  }
  useEffect(() => { finishColumnDrag() }, [scope])
  const commitTask = async (id: string, patch: TaskUpdateInput, targetId: string | null, after: boolean, groupId?: string) => {
    if (savingRef.current || id === targetId) return
    savingRef.current = true; setSavingTask(id); setMoveError('')
    try { await onMove(id, patch, targetId, after, groupId) }
    catch (reason) { setMoveError(`移动失败，任务保持原位。${reason instanceof Error ? reason.message : String(reason)}`) }
    finally { savingRef.current = false; setSavingTask(null) }
  }
  const isColumnDrag = (event: DragEvent<HTMLElement>) => event.dataTransfer.types.includes('application/x-chouyu-task-column')

  const dropInto = (event: DragEvent<HTMLElement>, column: BoardColumn) => {
    event.preventDefault()
    if (isColumnDrag(event)) {
      try {
        const payload = JSON.parse(event.dataTransfer.getData('application/x-chouyu-task-column'))
        if (payload.scope === scope && typeof payload.key === 'string') {
          const rect = event.currentTarget.getBoundingClientRect()
          if (previewOrderRef.current) saveColumnOrder(previewOrderRef.current)
          else moveColumn(payload.key, column.key, event.clientX > rect.left + rect.width / 2)
        }
      } catch { /* Ignore unrelated drag payloads. */ }
      finishColumnDrag()
      return
    }
    const target = cardTarget?.column === column.key ? cardTarget : null
    finishColumnDrag()
    if (column.archived || savingRef.current) return
    const id = event.dataTransfer.getData('text/plain')
    const task = id ? tasks.find(item => item.id === id) : undefined
    if (!task) return
    const sameColumn = columns.find(item => item.tasks.some(record => record.id === task.id))?.key === column.key
    const plan = taskGroupMove(task, groupMode, column, sameColumn)
    if (!plan) return
    const siblings = columns.find(item => item.key === column.key)?.tasks.filter(item => item.id !== task.id) ?? []
    const targetId = target?.id ?? siblings.at(-1)?.id ?? null
    void commitTask(task.id, plan.patch, targetId, target?.id ? target.after : true, column.key)
  }

  return <>{groupMode === 'due' && <p className="tasks-view-description">修改任务的截止时间后，会自动调整所属分组。</p>}{moveError && <p role="alert" className="tasks-error">{moveError}</p>}<div ref={boardRef} className="tasks-board" aria-label="任务看板" data-drag-active={draggingColumn !== null || draggingTask !== null || undefined}
    onDragOver={event => { if (isColumnDrag(event) || draggingTask !== null) updateScroll(event.clientX) }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { stopScroll(); setDropColumn(null); setColumnTarget(null) } }}
    onDragEnd={finishColumnDrag}>
    {columns.map(column => {
      const items = column.tasks
      return <section key={column.key || 'none'} className="tasks-board-column" data-column-key={column.key} data-motion-key={`column:${column.key}`} data-column-dragging={draggingColumn === column.key || undefined} data-column-insert={columnTarget?.key === column.key ? (columnTarget.after ? 'after' : 'before') : undefined} data-drop-target={dropColumn === column.key || undefined} aria-label={`${column.label}，${column.totalCount} 个任务`}
        onDragOver={event => {
          if (isColumnDrag(event)) {
            event.preventDefault(); event.dataTransfer.dropEffect = 'move'
            const rect = event.currentTarget.getBoundingClientRect()
            if (draggingColumn !== null && draggingColumn !== column.key) {
              const after = event.clientX > rect.left + rect.width / 2
              const keys = orderedKeys(draggingColumn, column.key, after)
              if (keys && keys.join('\0') !== previewOrderRef.current?.join('\0')) {
                previewOrderRef.current = keys; setPreviewOrder(keys)
              }
              setColumnTarget({ key: column.key, after })
            }
          } else if (!savingRef.current && !column.archived && (draggingTask !== null || event.dataTransfer.types.includes('text/plain'))) {
            const source = tasks.find(task => task.id === draggingTask)
            if (!source || !taskGroupMove(source, groupMode, column, column.tasks.some(task => task.id === draggingTask))) { event.dataTransfer.dropEffect = 'none'; return }
            event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropColumn(column.key)
            const card = (event.target as Element).closest<HTMLElement>('[data-task-id]')
            const rect = card?.getBoundingClientRect()
            const target = { column: column.key, id: card?.dataset.taskId ?? null, after: rect ? event.clientY > rect.top + rect.height / 2 : true }
            setCardTarget(current => current?.column === target.column && current?.id === target.id && current?.after === target.after ? current : target)
          }
        }}
        onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { setDropColumn(null); setColumnTarget(null) } }}
        onDrop={event => dropInto(event, column)}>
        <h3 className="tasks-board-column-title"><button type="button" className="tasks-column-drag-handle" draggable={!savingTask} aria-label={`移动看板列 ${column.label}`} title="拖动调整列位置；Alt + 左右方向键也可移动"
          onDragStart={event => { event.stopPropagation(); event.dataTransfer.setData('application/x-chouyu-task-column', JSON.stringify({ scope, key: column.key })); event.dataTransfer.effectAllowed = 'move'; setPreview(event, event.currentTarget.closest<HTMLElement>('.tasks-board-column')!); setDraggingColumn(column.key) }}
          onDragEnd={finishColumnDrag}
          onKeyDown={event => {
            if (!event.altKey || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
            event.preventDefault()
            const index = columns.findIndex(item => item.key === column.key)
            const target = columns[index + (event.key === 'ArrowRight' ? 1 : -1)]
            if (target) moveColumn(column.key, target.key, event.key === 'ArrowRight')
          }}><TaskIcon name="grip" /><span title={groupMode === 'custom' && column.key ? '双击修改分组名称' : undefined} onDoubleClick={event => { event.stopPropagation(); if (groupMode === 'custom' && column.key) onRenameGroup(column.key) }}>{column.label}</span><span className="tasks-count">{column.totalCount}</span></button>{!column.archived && column.canCreate !== false && <button type="button" className="tasks-column-add" aria-label={`在 ${column.label} 中新建任务`} title="新建任务" onClick={() => onCreate(column.patch, column.key)}><TaskIcon name="plus" /></button>}{renderGroupActions(column.key)}</h3>
        {items.length === 0 && <p className="tasks-board-empty">{column.totalCount > 0 ? '本组历史尚未加载，请点击底部「加载更多」' : groupMode === 'due' ? '暂无此截止时间的任务' : '暂无任务，可拖动任务到这里'}</p>}
        {items.length > 0 && column.totalCount > items.length && <p className="tasks-view-description">已加载 {items.length} / {column.totalCount}</p>}
        <ul role="list" className="tasks-board-cards">
          {items.map(task => {
            return <li key={task.id} className="tasks-board-card" data-completed={task.status === 'done' || undefined} onDragEnd={finishColumnDrag} draggable={!savingTask} tabIndex={0} data-task-id={task.id} data-card-insert={cardTarget?.id === task.id && draggingTask !== task.id ? (cardTarget.after ? 'after' : 'before') : undefined} data-saving={savingTask === task.id || undefined}
              onClick={event => {
                if ((event.target as Element).closest('button, summary, .tasks-quick-edit, a, input, select, textarea') || window.getSelection()?.toString()) return
                onEdit(task)
              }} onKeyDown={event => {
                if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); onEdit(task); return }
                if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key) || column.archived) return
                event.preventDefault(); const index = items.findIndex(item => item.id === task.id); const after = event.key === 'ArrowDown'; const target = items[index + (after ? 1 : -1)]
                if (target) void commitTask(task.id, {}, target.id, after)
              }} data-priority={task.priority} data-motion-key={`task:${task.id}`} data-task-dragging={draggingTask === task.id || undefined}
              onDragStart={event => { if (savingRef.current) { event.preventDefault(); return }; event.stopPropagation(); event.dataTransfer.setData('text/plain', task.id); event.dataTransfer.effectAllowed = 'move'; setPreview(event, event.currentTarget); setDraggingTask(task.id) }}>
              <button type="button" className="tasks-complete" data-done={task.status === 'done' || undefined} aria-label={`${task.status === 'done' ? '恢复' : '完成'} ${task.title}`} onClick={() => task.status === 'done' ? onReopen(task.id) : onComplete(task.id)}></button>
              <div className="tasks-board-card-body">
                <span className="tasks-board-card-head">

                  <span className="tasks-board-card-title">{task.title}</span>
                </span>
                {!hideNote && task.note && <span className="tasks-board-card-note">{task.note}</span>}
                <span className="tasks-board-card-chips"><TaskCardMeta task={task} projects={projects} fields={fields} onOpenProject={onOpenProject} onSource={onSource} /></span>
                {(task.startAt != null || task.dueAt !== null) && <span className="tasks-board-card-footer">{task.startAt != null && <span className="tasks-start-cell tasks-board-start" title={`开始时间：${formatTaskDue(task.startAt)}`}><TaskIcon name="today" />{formatTaskDue(task.startAt)} 开始</span>}<TaskCardDue task={task} /></span>}
              </div>
              {onQuickEdit && <TaskQuickEdit task={task} projects={projects} onSave={patch => onQuickEdit(task.id, patch)} />}
            </li>
          })}
        </ul>
        {cardTarget?.column === column.key && cardTarget.id === null && draggingTask && <div className="tasks-card-drop-slot" aria-hidden="true">放到这里</div>}
      </section>
    })}
    {groupMode === 'custom' && <button type="button" className="tasks-display-group-add" onClick={onNewGroup}><TaskIcon name="plus" />新建分组</button>}
  </div></>
}
