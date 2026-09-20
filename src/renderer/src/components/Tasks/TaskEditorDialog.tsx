import { useState, type FormEvent, type RefObject } from 'react'
import type { RemindChoiceId, TaskGroup, TaskPriority, TaskProject, TaskRecord, TaskSelectField } from '../../../../shared/tasks'
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

export default function TaskEditorDialog({ draft, projects, groups, fields, busy, error, dialogRef, onChange, onCreateProject, onClose, onSubmit }: {
  draft: TaskDraft
  projects: TaskProject[]
  groups: TaskGroup[]
  fields: TaskSelectField[]
  busy: boolean
  error: string
  dialogRef: RefObject<HTMLDivElement>
  onChange: (draft: TaskDraft) => void
  onCreateProject: (name: string, groupId: string) => Promise<TaskProject | null>
  onClose: () => void
  onSubmit: (event: FormEvent) => void
}) {
  const defaultGroupId = groups.find(group => group.isDefault)?.id ?? ''
  const [groupId, setGroupId] = useState(() => projects.find(project => project.id === draft.projectId)?.groupId ?? defaultGroupId)
  const [projectName, setProjectName] = useState('')
  const groupProjects = projects.filter(project => (project.groupId ?? defaultGroupId) === groupId && (!project.archivedAt || project.id === draft.projectId))
  const hasSelectedProject = groupProjects.some(project => project.id === draft.projectId)
  const changeGroup = (id: string) => {
    if (id === groupId) return
    const project = projects.find(project => (project.groupId ?? defaultGroupId) === id && !project.archivedAt)
    setGroupId(id); setProjectName('')
    onChange({ ...draft, projectId: project?.id ?? '' })
  }
  const createProject = async () => {
    if (!projectName.trim() || busy) return
    const project = await onCreateProject(projectName.trim(), groupId)
    if (project) { onChange({ ...draft, projectId: project.id }); setProjectName('') }
  }
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
          <input value={draft.title} disabled={busy} onChange={e => onChange({ ...draft, title: e.target.value })}
            autoFocus aria-label="任务标题" placeholder={draft.id ? "任务标题" : "准备做些什么？"} />
        </label>
        <div className="tasks-composer-properties">
          <div className="tasks-select-field">
            <span>所属分组</span>
            <TaskSelect label="任务分组" value={groupId} disabled={busy} onChange={changeGroup} options={groups.map(group => ({ value: group.id, label: group.name }))} />
          </div>
          <div className="tasks-select-field">
            <span>所属清单</span>
            <TaskSelect label="任务清单" value={draft.projectId} disabled={busy || groupProjects.length === 0} onChange={projectId => onChange({ ...draft, projectId })} options={groupProjects.map(project => ({ value: project.id, label: project.name + (project.archivedAt ? '（已归档）' : '') }))} />
          </div>
        </div>
        {groupProjects.length === 0 && <div className="tasks-composer-new-project">
          <p>这个分组还没有可用清单，创建一个后即可保存任务。</p>
          <div><input aria-label="新清单名称" placeholder="清单名称" maxLength={50} value={projectName} disabled={busy} onChange={event => setProjectName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void createProject() } }} /><button type="button" disabled={busy || !projectName.trim()} onClick={() => void createProject()}>创建清单</button></div>
        </div>}
        <div className="tasks-composer-properties">
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
          <textarea value={draft.note} disabled={busy} onChange={e => onChange({ ...draft, note: e.target.value })} aria-label="任务备注" placeholder="补充背景、目标或需要注意的事情…" rows={4} />
        </label>
        {fields.length > 0 && <div className="tasks-composer-properties" role="group" aria-label="自定义字段">
          {fields.map(field => <div className="tasks-select-field" key={field.id}>
            <span>{field.name}</span>
            <TaskSelect label={`任务 ${field.name}`} value={draft.customFields[field.id] ?? ''} disabled={busy} onChange={value => onChange({ ...draft, customFields: { ...draft.customFields, [field.id]: value } })} options={[{ value: '', label: '未设置' }, ...field.options.map(option => ({ value: option.id, label: option.name }))]} />
          </div>)}
        </div>}
        <div className="tasks-form-actions"><span className="tasks-composer-hint">{draft.id ? "修改后保存即可更新任务" : "填写标题即可创建任务"}</span>
          <button type="button" disabled={busy} onClick={() => onClose()}>取消</button>
          <button type="submit" disabled={busy || !draft.title.trim() || !hasSelectedProject}>{busy ? '保存中…' : draft.id ? '保存' : '创建'}</button>
        </div>
          </form>
        </div>
      </div>
}
