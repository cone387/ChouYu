import { useId, useRef, useState } from 'react'
import type { TaskRecord } from '../../../../shared/tasks'

export default function TaskCardChecklist({ task }: { task: TaskRecord }) {
  const [expanded, setExpanded] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const regionId = useId()
  const items = task.checklist ?? []
  if (!items.length) return null
  const toggle = async (itemId: string, done: boolean) => {
    if (lock.current) return
    lock.current = true; setPending(itemId); setError('')
    try { await window.electronAPI.tasks.setChecklistItemDone(task.id, itemId, done) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { lock.current = false; setPending(null) }
  }
  return <span className="task-card-checklist" onClick={event => event.stopPropagation()}
    onKeyDown={event => event.stopPropagation()} onDragStart={event => { event.preventDefault(); event.stopPropagation() }}>
    <button type="button" className="tasks-card-field-button task-card-checklist-toggle" aria-expanded={expanded} aria-controls={regionId}
      aria-label={`${expanded ? '收起' : '展开'} ${task.title} 的子项`} onClick={() => setExpanded(value => !value)}>
      <span aria-hidden="true">{expanded ? '▾' : '▸'}</span> 子项 {items.filter(item => item.done).length}/{items.length}
    </button>
    {expanded && <span id={regionId} className="task-card-checklist-items" role="group" aria-label={`${task.title} 的子项`} aria-busy={pending !== null}>
      {items.map(item => <label key={item.id} className="task-card-checklist-row" data-done={item.done || undefined}>
        <input type="checkbox" checked={item.done} disabled={pending !== null} aria-label={`${item.done ? '恢复' : '完成'}子项 ${item.title}`}
          onChange={event => void toggle(item.id, event.target.checked)} />
        <span>{item.title}</span>
      </label>)}
      <span className="task-card-checklist-status" role="status">{pending ? '保存中…' : ''}</span>
      {error && <span role="alert" className="tasks-error">保存失败：{error} 可重新勾选重试。</span>}
    </span>}
  </span>
}
