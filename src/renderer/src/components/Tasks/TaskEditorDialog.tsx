import { useState, type FormEvent, type RefObject } from 'react'
import type { RemindChoiceId, TaskGroup, TaskPriority, TaskProject, TaskRecord, TaskSelectField } from '../../../../shared/tasks'
import { PRIORITY_LABELS } from '../../../../shared/tasks'
import TaskDatePicker from './TaskDatePicker'
import TaskSelect from './TaskSelect'
import TaskIcon from './TaskIcon'
import type { TaskDisplayGroup } from './taskViewPreferences'

export interface TaskDraft {
  checklist?: TaskRecord['checklist']
  source?: TaskRecord['source']
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
  displayGroupId?: string
}

export default function TaskEditorDialog({ draft, projects, groups, displayGroups, fields, busy, error, dialogRef, onChange, onCreateProject, onClose, onSubmit }: {
  draft: TaskDraft
  projects: TaskProject[]
  groups: TaskGroup[]
  displayGroups: TaskDisplayGroup[]
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
  const [newItem, setNewItem] = useState('')
  const addItem = () => {
    if (!newItem.trim() || busy || (draft.checklist?.length ?? 0) >= 100) return
    onChange({ ...draft, checklist: [...draft.checklist ?? [], { id: crypto.randomUUID(), title: newItem.trim(), done: false }] }); setNewItem('')
  }
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
        {draft.source && <p className="tasks-composer-hint">来源：{draft.source.label}。{draft.id ? '可通过任务卡片回看原始内容。' : '创建后可回看来源；取消不会创建任务。'}</p>}
        <label className="tasks-composer-title">
          <span className="sr-only">标题</span>
          <input value={draft.title} disabled={busy} onChange={e => onChange({ ...draft, title: e.target.value })}
            autoFocus aria-label="任务标题" placeholder={draft.id ? "任务标题" : "准备做些什么？"} />
        </label>
        <div className="tasks-composer-properties">
          <div className="tasks-select-field">
            <span>清单分组</span>
            <TaskSelect label="任务分组" value={groupId} disabled={busy} onChange={changeGroup} options={groups.map(group => ({ value: group.id, label: group.name }))} />
          </div>
          <div className="tasks-select-field">
            <span>所属清单</span>
            <TaskSelect label="任务清单" value={draft.projectId} disabled={busy || groupProjects.length === 0} onChange={projectId => onChange({ ...draft, projectId })} options={groupProjects.map(project => ({ value: project.id, label: project.name + (project.archivedAt ? '（已归档）' : '') }))} />
          </div>
        </div>
        {displayGroups.length > 0 && <div className="tasks-composer-properties"><div className="tasks-select-field">
          <span>当前视图分组</span>
          <TaskSelect label="任务展示分组" value={draft.displayGroupId ?? ''} disabled={busy} onChange={displayGroupId => onChange({ ...draft, displayGroupId })} options={[{ value: '', label: '未分组' }, ...displayGroups.map(group => ({ value: group.id, label: group.name }))]} />
        </div></div>}
        {groupProjects.length === 0 && <div className="tasks-composer-new-project">
          <p>这个分组还没有可用清单，创建一个后即可保存任务。</p>
          <div><input aria-label="新清单名称" placeholder="清单名称" value={projectName} disabled={busy} onChange={event => setProjectName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void createProject() } }} /><button type="button" disabled={busy || !projectName.trim()} onClick={() => void createProject()}>创建清单</button></div>
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
        <fieldset className="tasks-checklist-editor" disabled={busy}>
          <legend>子项 {draft.checklist?.filter(item => item.done).length ?? 0}/{draft.checklist?.length ?? 0}</legend>
          <small>子项不单独提醒；勾选子项不会改变父任务状态。重复任务的下一期会重置子项勾选。</small>
          {(draft.checklist ?? []).map(item => <div key={item.id}>
            <input type="checkbox" aria-label={`完成子项 ${item.title}`} checked={item.done} onChange={event => onChange({ ...draft, checklist: draft.checklist!.map(value => value.id === item.id ? { ...value, done: event.target.checked } : value) })} />
            <input aria-label="子项名称" maxLength={200} value={item.title} onChange={event => onChange({ ...draft, checklist: draft.checklist!.map(value => value.id === item.id ? { ...value, title: event.target.value } : value) })} />
            <button type="button" aria-label={`删除子项 ${item.title}`} onClick={() => onChange({ ...draft, checklist: draft.checklist!.filter(value => value.id !== item.id) })}>×</button>
          </div>)}
          <div><input aria-label="新子项名称" placeholder="添加一个步骤" maxLength={200} value={newItem} onChange={event => setNewItem(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addItem() } }} /><button type="button" disabled={!newItem.trim() || (draft.checklist?.length ?? 0) >= 100} onClick={addItem}>添加子项</button></div>
        </fieldset>
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
