import type { FormEvent, RefObject } from 'react'
import type { RemindChoiceId, TaskPriority, TaskProject, TaskRecord, TaskSelectField } from '../../../../shared/tasks'
import { PRIORITY_LABELS } from '../../../../shared/tasks'
import TaskDatePicker from './TaskDatePicker'
import TaskSelect from './TaskSelect'
import TaskIcon from './TaskIcon'

export interface TaskDraft {
  id: string
  title: string
  note: string
  projectId: string
  priority: TaskPriority
  startDate: string
  startTime: string
  dueDate: string
  dueTime: string
  remind: RemindChoiceId
  recurrence: TaskRecord['recurrence']
  customFields: Record<string, string>
}

export default function TaskEditorDialog({ draft, projects, fields, busy, error, dialogRef, onChange, onClose, onSubmit }: {
  draft: TaskDraft
  projects: TaskProject[]
  fields: TaskSelectField[]
  busy: boolean
  error: string
  dialogRef: RefObject<HTMLDivElement>
  onChange: (draft: TaskDraft) => void
  onClose: () => void
  onSubmit: (event: FormEvent) => void
}) {
  return <div className="tasks-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
        <div ref={dialogRef} className="tasks-dialog tasks-composer" role="dialog" aria-modal="true" aria-labelledby="tasks-dialog-title" onMouseDown={event => event.stopPropagation()}>
          <header className="tasks-dialog-header">
            <h2 id="tasks-dialog-title"><TaskIcon name="task" />{draft.id ? '编辑任务' : '新建任务'}</h2>
            <button type="button" aria-label="关闭任务弹窗" disabled={busy} onClick={() => onClose()}>×</button>
          </header>
          <form className="tasks-form" onSubmit={onSubmit} aria-label={draft.id ? '编辑任务' : '新建任务'}>
        {error && <p role="alert" className="tasks-error">{error}</p>}
        <label className="tasks-composer-title">
          <span className="sr-only">标题</span>
          <input value={draft.title} onChange={e => onChange({ ...draft, title: e.target.value })}
            onKeyDown={e => { if (e.key === 'Escape' && !busy) onClose() }}
            autoFocus aria-label="任务标题" placeholder={draft.id ? "任务标题" : "准备做些什么？"} />
        </label>
        <div className="tasks-composer-properties">
          <div className="tasks-select-field">
            <span>所属清单</span>
            <TaskSelect label="任务清单" value={draft.projectId} disabled={busy} onChange={projectId => onChange({ ...draft, projectId })} options={projects.filter(project => !project.archivedAt || project.id === draft.projectId).map(project => ({ value: project.id, label: project.name + (project.archivedAt ? '（已归档）' : '') }))} />
          </div>
          <div className="tasks-select-field">
            <span>优先级</span>
            <div className="tasks-priority-options" role="group" aria-label="任务优先级">
              {(['high', 'medium', 'low'] as TaskPriority[]).map(priority => <button key={priority} type="button" disabled={busy} data-priority={priority} aria-pressed={draft.priority === priority} onClick={() => onChange({ ...draft, priority })}><span aria-hidden="true" />{PRIORITY_LABELS[priority]}</button>)}
            </div>
          </div>

        </div>
        <div className="tasks-composer-properties"><div className="tasks-select-field"><span>时间安排</span><TaskDatePicker draft={draft} busy={busy} onChange={onChange} /></div></div>
        <label className="tasks-composer-description">
          <span><TaskIcon name="edit" />任务描述</span>
          <textarea value={draft.note} onChange={e => onChange({ ...draft, note: e.target.value })} aria-label="任务备注" placeholder="补充背景、目标或需要注意的事情…" rows={4} />
        </label>
        {fields.length > 0 && <div className="tasks-composer-properties" role="group" aria-label="自定义字段">
          {fields.map(field => <div className="tasks-select-field" key={field.id}>
            <span>{field.name}</span>
            <TaskSelect label={`任务 ${field.name}`} value={draft.customFields[field.id] ?? ''} disabled={busy} onChange={value => onChange({ ...draft, customFields: { ...draft.customFields, [field.id]: value } })} options={[{ value: '', label: '未设置' }, ...field.options.map(option => ({ value: option.id, label: option.name }))]} />
          </div>)}
        </div>}
        <div className="tasks-form-actions"><span className="tasks-composer-hint">{draft.id ? "修改后保存即可更新任务" : "填写标题即可创建任务"}</span>
          <button type="button" disabled={busy} onClick={() => onClose()}>取消</button>
          <button type="submit" disabled={busy || !draft.title.trim()}>{busy ? '保存中…' : draft.id ? '保存' : '创建'}</button>
        </div>
          </form>
        </div>
      </div>
}
