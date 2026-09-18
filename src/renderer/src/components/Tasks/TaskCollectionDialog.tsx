import { useEffect, useRef, type FormEvent } from 'react'
import type { TaskGroup } from '../../../../shared/tasks'

interface Props {
  title: string
  name: string
  onNameChange: (name: string) => void
  groups?: TaskGroup[]
  groupId?: string
  onGroupChange?: (id: string) => void
  busy: boolean
  error: string
  editing?: boolean
  onSubmit: (event: FormEvent) => void
  onClose: () => void
}

export default function TaskCollectionDialog({ title, name, onNameChange, groups, groupId, onGroupChange, busy, error, editing, onSubmit, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.querySelector<HTMLInputElement>('input')?.focus()
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])
  return <div className="tasks-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <div ref={dialogRef} className="tasks-dialog tasks-collection-dialog" role="dialog" aria-modal="true" aria-labelledby="tasks-collection-title" onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); if (!busy) onClose() }
      if (event.key !== 'Tab') return
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)') ?? [])
      const first = controls[0], last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}>
      <header className="tasks-dialog-header"><h2 id="tasks-collection-title">{title}</h2><button type="button" disabled={busy} aria-label="关闭清单分组弹窗" onClick={onClose}>×</button></header>
      <form className="tasks-form tasks-collection-form" onSubmit={onSubmit}>
        {error && <p role="alert" className="tasks-error">{error}</p>}
        <label>{groups ? '清单名称' : '分组名称'}<input value={name} maxLength={50} required onChange={event => onNameChange(event.target.value)} placeholder={groups ? '输入清单名称' : '输入分组名称'} /></label>
        {groups && <label>所属分组<select value={groupId} onChange={event => onGroupChange?.(event.target.value)}>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}
        <div className="tasks-form-actions"><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="submit" disabled={busy || !name.trim()}>{busy ? '保存中…' : editing ? '保存' : '创建'}</button></div>
      </form>
    </div>
  </div>
}
