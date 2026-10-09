import DateTimePicker from '../common/DateTimePicker'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { PRIORITY_LABELS, type TaskPriority, type TaskRecord, type TaskUpdateInput } from '../../../../shared/tasks'

export type EditableTaskField = 'priority' | 'dueAt'
export const taskDateInput = (at: number | null): string => {
  if (at === null) return ''
  const date = new Date(at)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export default function TaskFieldEditor({ task, field, onClose, onSaved }: {
  task: TaskRecord; field: EditableTaskField; onClose(): void; onSaved(task: TaskRecord): void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [priority, setPriority] = useState(task.priority)
  const [date, setDate] = useState(taskDateInput(task.dueAt))
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [error, setError] = useState('')
  const [discard, setDiscard] = useState(false)
  const changed = field === 'priority' ? priority !== task.priority : date !== taskDateInput(task.dueAt)
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
    const patch: TaskUpdateInput = field === 'priority' ? { priority } : { dueAt: date ? new Date(date).getTime() : null }
    if (patch.dueAt != null && (!Number.isFinite(patch.dueAt) || (task.startAt != null && patch.dueAt < task.startAt))) {
      setError('截止时间必须有效，且不能早于开始时间。'); return
    }
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
      <h2 id="task-field-title">修改{field === 'priority' ? '优先级' : '截止时间'}</h2>
      <p className="tasks-field-task-title">{task.title}</p>
      {field === 'priority' ? <label>优先级<select autoFocus aria-label="卡片优先级" disabled={busy} value={priority} onChange={event => { setPriority(event.target.value as TaskPriority); setDiscard(false) }}>
        {(['high', 'medium', 'low'] as const).map(value => <option key={value} value={value}>{PRIORITY_LABELS[value]}</option>)}
      </select></label> : <>
        <div><DateTimePicker label="卡片截止时间" disabled={busy} value={date} onChange={value => { setDate(value); setDiscard(false) }} /></div>
        <button type="button" disabled={busy || !date} onClick={() => { setDate(''); setDiscard(false) }}>清除截止时间</button>
        {changed && task.dueAt !== null && <p className="tasks-composer-hint">{date ? '已有提醒将随截止时间整体平移，重复任务将以新日期重新计算。' : '清除截止时间会同时取消任务提醒和重复规则。'}</p>}
      </>}
      {error && <p role="alert" className="tasks-error">{error}</p>}
      {discard && <p role="alert">修改尚未保存。可以保存、继续编辑，或放弃修改。</p>}
      <div className="tasks-form-actions">
        {discard ? <><button type="button" disabled={busy} onClick={() => setDiscard(false)}>继续编辑</button><button type="button" disabled={busy} onClick={onClose}>放弃修改</button></> : <button type="button" disabled={busy} onClick={close}>取消</button>}
        <button type="submit" disabled={busy}>{busy ? '保存中…' : '保存'}</button>
      </div>
    </form>
  </dialog>
}
