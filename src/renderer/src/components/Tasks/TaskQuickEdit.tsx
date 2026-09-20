import { useState } from 'react'
import type { TaskPriority, TaskProject, TaskRecord, TaskUpdateInput } from '../../../../shared/tasks'
import { PRIORITY_LABELS, rescheduleTaskDate } from '../../../../shared/tasks'
import TaskIcon from './TaskIcon'

export default function TaskQuickEdit({ task, projects, onSave }: { task: TaskRecord; projects: TaskProject[]; onSave: (patch: TaskUpdateInput) => Promise<unknown> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async (patch: TaskUpdateInput) => {
    setBusy(true); setError('')
    try { await onSave(patch) } catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  return <details className="tasks-tool-menu tasks-quick-edit">
    <summary aria-label={`快捷编辑 ${task.title}`} title="快捷编辑优先级、清单和日期"><TaskIcon name="edit" /></summary>
    <div className="tasks-item-menu-popover">
      <label>优先级<select aria-label={`修改优先级 ${task.title}`} disabled={busy} value={task.priority} onChange={event => void save({ priority: event.target.value as TaskPriority })}>{(['high', 'medium', 'low'] as const).map(value => <option key={value} value={value}>{PRIORITY_LABELS[value]}</option>)}</select></label>
      <label>清单<select aria-label={`移动到清单 ${task.title}`} disabled={busy} value={task.projectId ?? ''} onChange={event => void save({ projectId: event.target.value })}>{projects.filter(project => !project.archivedAt || project.id === task.projectId).map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
      <form onSubmit={event => {
        event.preventDefault()
        const date = String(new FormData(event.currentTarget).get('date') ?? '')
        try { void save(rescheduleTaskDate(task, date)) } catch (reason) { setError(String(reason)) }
      }}>
        <label>改期至<input type="date" name="date" aria-label={`改期日期 ${task.title}`} required disabled={busy} /></label>
        <small>保留具体时间和跨天时长</small>
        <button type="submit" data-menu-keep-open disabled={busy}>应用日期</button>
      </form>
      {error && <p role="alert">{error}</p>}
    </div>
  </details>
}
