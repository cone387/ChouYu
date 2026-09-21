import { useState, type DragEvent } from 'react'
import type { TaskView } from '../../../../shared/tasks'
import TaskIcon, { type IconName } from './TaskIcon'

export interface ManageViewEntry { key: string; label: string; icon: IconName; custom?: TaskView }

export default function TaskViewManageDialog({ entries, hidden, onClose, onToggle, onReorder, onEditView, onDeleteView }: {
  entries: ManageViewEntry[]
  hidden: string[]
  onClose: () => void
  onToggle: (key: string) => void
  onReorder: (order: string[]) => void
  onEditView: (view: TaskView) => void
  onDeleteView: (view: TaskView) => void
}) {
  const [order, setOrder] = useState(() => entries.map(entry => entry.key))
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<{ key: string; after: boolean } | null>(null)
  const rows = order.flatMap(key => { const entry = entries.find(item => item.key === key); return entry ? [entry] : [] })
  const move = (source: string, target: string, after: boolean) => {
    const keys = order.filter(key => key !== source)
    const index = keys.indexOf(target)
    if (source === target || index < 0) return
    keys.splice(index + Number(after), 0, source)
    setOrder(keys)
    onReorder(keys)
  }
  const rowDrag = (entry: ManageViewEntry) => ({
    draggable: true,
    onDragStart: (event: DragEvent<HTMLElement>) => { setDragKey(entry.key); event.dataTransfer.setData('application/x-chouyu-manage-view', entry.key); event.dataTransfer.effectAllowed = 'move' },
    onDragEnd: () => { setDragKey(null); setDropTarget(null) },
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (dragKey === null || dragKey === entry.key || !event.dataTransfer.types.includes('application/x-chouyu-manage-view')) return
      event.preventDefault(); event.dataTransfer.dropEffect = 'move'
      const rect = event.currentTarget.getBoundingClientRect()
      const after = event.clientY > rect.top + rect.height / 2
      setDropTarget(current => current?.key === entry.key && current.after === after ? current : { key: entry.key, after })
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      const id = event.dataTransfer.getData('application/x-chouyu-manage-view')
      if (id) move(id, entry.key, dropTarget?.key === entry.key ? dropTarget.after : true)
      setDragKey(null); setDropTarget(null)
    }
  })
  return <div className="tasks-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div className="tasks-dialog tasks-view-dialog" role="dialog" aria-modal="true" aria-labelledby="tasks-manage-dialog-title" onMouseDown={event => event.stopPropagation()}>
      <header className="tasks-dialog-header">
        <h2 id="tasks-manage-dialog-title">管理视图</h2>
        <button type="button" aria-label="关闭管理视图" onClick={onClose}>×</button>
      </header>
      <div className="tasks-form" aria-label="管理视图">
        <p className="tasks-composer-hint">拖动调整顺序；勾选「显示在侧栏」，未勾选的视图收进「更多」。</p>
        <ul role="list" className="tasks-manage-list">
          {rows.map(entry => <li key={entry.key} className="tasks-manage-row" data-order-insert={dropTarget?.key === entry.key ? (dropTarget.after ? 'after' : 'before') : undefined} data-dragging={dragKey === entry.key || undefined} {...rowDrag(entry)}>
            <span className="tasks-manage-drag" aria-hidden="true"><TaskIcon name="grip" /></span>
            <label className="tasks-manage-check">
              <input type="checkbox" checked={!hidden.includes(entry.key)} onChange={() => onToggle(entry.key)} aria-label={`显示 ${entry.label} 在侧栏`} />
              <TaskIcon name={entry.icon} /><span className="tasks-nav-label">{entry.label}</span>
            </label>
            {entry.custom && <>
              <button type="button" className="tasks-more-view-action" aria-label={`编辑视图 ${entry.label}`} title="编辑视图" onClick={() => onEditView(entry.custom!)}><TaskIcon name="edit" /></button>
              <button type="button" className="tasks-more-view-action tasks-item-menu-danger" aria-label={`删除视图 ${entry.label}`} title="删除视图" onClick={() => onDeleteView(entry.custom!)}><TaskIcon name="trash" /></button>
            </>}
          </li>)}
        </ul>
        <div className="tasks-form-actions">
          <button type="button" onClick={onClose}>完成</button>
        </div>
      </div>
    </div>
  </div>
}
