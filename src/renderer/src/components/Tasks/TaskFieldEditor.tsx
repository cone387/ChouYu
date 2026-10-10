import { DateTimeDialog } from '../common/DateTimePicker'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { PRIORITY_LABELS, type TaskPriority, type TaskRecord, type TaskUpdateInput } from '../../../../shared/tasks'

export type EditableTaskField = 'priority' | 'dueAt'
export const taskDateInput = (at: number | null): string => {
  if (at === null) return ''
  const date = new Date(at)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

interface TaskFieldEditorProps {
  task: TaskRecord; field: EditableTaskField; onClose(): void; onSaved(task: TaskRecord): void
}

export default function TaskFieldEditor(props: TaskFieldEditorProps) {
  const { task, field, onClose, onSaved } = props
  if (field === 'priority') return <TaskPriorityEditor {...props} />
  const original = taskDateInput(task.dueAt)
  return <DateTimeDialog label="截止时间" subtitle={task.title} value={original}
    min={task.startAt == null ? undefined : taskDateInput(task.startAt)} confirmLabel="保存" clearAsDraft confirmDiscard onClose={onClose}
    getHint={next => next === original || task.dueAt === null ? '' : next ? '已有提醒将随截止时间整体平移，重复任务将以新日期重新计算。' : '清除截止时间会同时取消任务提醒和重复规则。'}
    onChange={async next => {
      if (next === original) return
      const dueAt = next ? new Date(next).getTime() : null
      if (dueAt !== null && (!Number.isFinite(dueAt) || task.startAt != null && dueAt < task.startAt)) throw new Error('截止时间必须有效，且不能早于开始时间。')
      const current = await window.electronAPI.tasks.get(task.id)
      if (!current || JSON.stringify(current) !== JSON.stringify(task)) throw new Error('任务已发生变化，请关闭并重新打开后编辑。')
      const saved = await window.electronAPI.tasks.update(task.id, { dueAt })
      onSaved(saved)
    }} />
}

function TaskPriorityEditor({ task, onClose, onSaved }: TaskFieldEditorProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [priority, setPriority] = useState(task.priority)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [error, setError] = useState('')
  const [discard, setDiscard] = useState(false)
  const changed = priority !== task.priority
  const close = () => { if (!lock.current) { if (changed) setDiscard(true); else onClose() } }
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.showModal()
    return () => { if (opener?.isConnected) opener.focus({ preventScroll: true }) }
  }, [])
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (lock.current) return
    if (!changed) { onClose(); return }
    const patch: TaskUpdateInput = { priority }
    lock.current = true; setBusy(true); setError('')
    try {
      const current = await window.electronAPI.tasks.get(task.id)
      if (!current || JSON.stringify(current) !== JSON.stringify(task)) throw new Error('任务已发生变化，请关闭并重新打开后编辑。')
      const saved = await window.electronAPI.tasks.update(task.id, patch)
      onSaved(saved); onClose()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { lock.current = false; setBusy(false) }
  }
  return <dialog ref={dialog} className="tasks-field-editor" data-interactive aria-labelledby="task-field-title"
    onCancel={event => { event.preventDefault(); if (discard) setDiscard(false); else close() }}
    onKeyDown={event => event.stopPropagation()}>
    <form onSubmit={event => void save(event)}>
      <header className="tasks-field-header">
        <div><h2 id="task-field-title">修改优先级</h2><p className="tasks-field-task-title" title={task.title}>{task.title}</p></div>
        <button type="button" className="tasks-field-close" aria-label="关闭字段编辑" disabled={busy} onClick={close}>×</button>
      </header>
      <div className="tasks-field-body">
      <label>优先级<select autoFocus aria-label="卡片优先级" disabled={busy} value={priority} onChange={event => { setPriority(event.target.value as TaskPriority); setDiscard(false) }}>
        {(['high', 'medium', 'low'] as const).map(value => <option key={value} value={value}>{PRIORITY_LABELS[value]}</option>)}
      </select></label>
      {error && <p role="alert" className="tasks-error">{error}</p>}
      {discard && <p role="alert" className="tasks-field-discard">修改尚未保存。可以保存、继续编辑，或放弃修改。</p>}
      </div>
      <footer className="tasks-form-actions">
        {discard ? <><button type="button" disabled={busy} onClick={() => setDiscard(false)}>继续编辑</button><button type="button" disabled={busy} onClick={onClose}>放弃修改</button></> : <button type="button" className="tasks-field-cancel" disabled={busy} onClick={close}>取消</button>}
        <button type="submit" disabled={busy}>{busy ? '保存中…' : '保存'}</button>
      </footer>
    </form>
  </dialog>
}
