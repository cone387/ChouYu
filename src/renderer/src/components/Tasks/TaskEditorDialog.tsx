import TaskScheduleSettings from './TaskScheduleSettings'
import { draftReminderTimes } from './taskDraftScheduling'
import { repeatDescription } from '../../../../shared/taskScheduling'
import TaskDateTimePicker from '../common/DateTimePicker'
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react'
import { useConfirm } from '../common/ConfirmProvider'
import type { RemindChoiceId, TaskChecklistItem, TaskGroup, TaskPriority, TaskProject, TaskRecord, TaskSelectField } from '../../../../shared/tasks'
import { PRIORITY_LABELS, REMIND_CHOICES, remindAtFromChoice } from '../../../../shared/tasks'
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
  repeatRule?: TaskRecord['repeatRule']
  reminderOffsets?: number[]
  reminderTimes?: number[]
  originalDueAt?: number | null
  originalStartAt?: number | null
  recurrenceIndex?: number
  recurrenceAnchorAt?: number | null
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
  let repeatLabel = '自定义重复（待完善）'
  try { repeatLabel = repeatDescription(draft.recurrence, draft.repeatRule) } catch { /* Keep incomplete rules editable; validation stays in the settings panel. */ }
  const [groupId, setGroupId] = useState(() => projects.find(project => project.id === draft.projectId)?.groupId ?? defaultGroupId)
  const [projectName, setProjectName] = useState('')
  const [newItem, setNewItem] = useState('')
  const [itemsExpanded, setItemsExpanded] = useState(true)
  const [itemDialogOpen, setItemDialogOpen] = useState(false)
  const [newItemDue, setNewItemDue] = useState('')
  const [newItemRemind, setNewItemRemind] = useState<RemindChoiceId>('none')
  const itemDialogRef = useRef<HTMLDialogElement>(null)
  const [draggedItem, setDraggedItem] = useState<string | null>(null)
  const [dropItem, setDropItem] = useState<{ id: string; after: boolean } | null>(null)
  useEffect(() => { if (itemDialogOpen) itemDialogRef.current?.showModal() }, [itemDialogOpen])
  const closeItemDialog = () => { setItemDialogOpen(false); setNewItem(''); setNewItemDue(''); setNewItemRemind('none') }
  const original = useRef(JSON.stringify(draft))
  const confirm = useConfirm()
  const closing = useRef(false)
  const requestClose = async () => {
    if (busy || closing.current) return
    closing.current = true
    try {
      const dirty = JSON.stringify(draft) !== original.current || !!newItem.trim() || !!projectName.trim()
      if (!dirty || await confirm({ title: '放弃未保存的修改？', message: '关闭后，本次修改和尚未添加的子项内容将丢失。取消可返回编辑并保存。', confirmLabel: '放弃修改' })) onClose()
    } finally { closing.current = false }
  }
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      event.stopPropagation()
      void requestClose()
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  })
  const toDateTimeLocal = (at: number | null | undefined): string => {
    if (at == null) return ''
    const date = new Date(at)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }
  const itemDueAt = (value: string): number | null => value ? new Date(value).getTime() : null
  const itemRemindChoice = (item: TaskChecklistItem): RemindChoiceId => {
    if (item.dueAt == null || item.reminders?.length !== 1 || item.reminders[0].firedAt !== null) return 'none'
    for (const choice of REMIND_CHOICES) if (remindAtFromChoice(choice.id, item.dueAt) === item.reminders[0].at) return choice.id
    return 'none'
  }
  const patchItem = (id: string, patch: Partial<TaskChecklistItem>) => onChange({ ...draft, checklist: draft.checklist!.map(value => value.id === id ? { ...value, ...patch } : value) })
  const moveItem = (id: string, target: string, after: boolean) => {
    if (busy || id === target) return
    const items = draft.checklist ?? []
    const item = items.find(value => value.id === id)
    if (!item || !items.some(value => value.id === target)) return
    const next = items.filter(value => value.id !== id)
    next.splice(next.findIndex(value => value.id === target) + Number(after), 0, item)
    onChange({ ...draft, checklist: next })
  }
  const addItem = (event: FormEvent) => {
    event.preventDefault(); event.stopPropagation()
    if (!newItem.trim() || busy || (draft.checklist?.length ?? 0) >= 100) return
    const dueAt = itemDueAt(newItemDue)
    const at = remindAtFromChoice(newItemRemind, dueAt)
    onChange({ ...draft, checklist: [...draft.checklist ?? [], { id: crypto.randomUUID(), title: newItem.trim(), done: false, dueAt, reminders: at === null ? [] : [{ at, firedAt: null }] }] })
    closeItemDialog()
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
  return <div className="tasks-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) void requestClose() }}>
        <div ref={dialogRef} className="tasks-dialog tasks-composer" role="dialog" aria-modal="true" aria-labelledby="tasks-dialog-title" onMouseDown={event => event.stopPropagation()}>
          <header className="tasks-dialog-header">
            <h2 id="tasks-dialog-title"><TaskIcon name="task" />{draft.id ? '编辑任务' : '新建任务'}</h2>
            <button type="button" aria-label="关闭任务弹窗" disabled={busy} onClick={() => void requestClose()}>×</button>
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
        {(['reminder', 'repeat'] as const).map(section => <div className="tasks-composer-properties" key={section}><div className="tasks-select-field">
          <span>{section === 'reminder' ? '提醒' : '重复'}</span>
          <details className="tasks-tool-menu tasks-schedule-property">
            <summary aria-label={section === 'reminder' ? '设置任务提醒' : '设置任务重复'} aria-disabled={busy} onClick={event => { if (busy) event.preventDefault() }}><span>{section === 'reminder' ? (draftReminderTimes(draft).length ? `${draftReminderTimes(draft).length} 个提醒` : '不提醒') : repeatLabel}</span><TaskIcon name="chevron" /></summary>
            <div className="tasks-item-menu-popover tasks-schedule-property-popover" role="group" aria-label={section === 'reminder' ? '任务提醒设置' : '任务重复设置'}>
              <div className="tasks-date-page"><TaskScheduleSettings section={section} draft={draft} busy={busy} onChange={onChange} /></div>
              <footer className="tasks-calendar-footer"><button type="button">完成</button></footer>
            </div>
          </details>
        </div></div>)}
        <label className="tasks-composer-description">
          <span><TaskIcon name="edit" />任务描述</span>
          <textarea value={draft.note} disabled={busy} onChange={e => onChange({ ...draft, note: e.target.value })} aria-label="任务备注" placeholder="补充背景、目标或需要注意的事情…" rows={4} />
        </label>
        <section className="tasks-checklist-editor" aria-label="子项" aria-disabled={busy}>
          <div className="tasks-checklist-heading"><button type="button" className="tasks-checklist-collapse" aria-expanded={itemsExpanded} aria-controls="tasks-editor-checklist" onClick={() => setItemsExpanded(value => !value)}><span className="tasks-disclosure-icon" data-expanded={itemsExpanded}><TaskIcon name="disclosure" /></span>子项 {draft.checklist?.filter(item => item.done).length ?? 0}/{draft.checklist?.length ?? 0}</button><button type="button" aria-label="新增子项" title="新增子项" disabled={busy || (draft.checklist?.length ?? 0) >= 100} onClick={() => { setItemsExpanded(true); setItemDialogOpen(true) }}><TaskIcon name="plus" /></button></div>
          <div id="tasks-editor-checklist" className="tasks-checklist-items" hidden={!itemsExpanded}>
          {(draft.checklist ?? []).map((item, index, items) => <div key={item.id} className="tasks-checklist-row" data-checklist-id={item.id} data-card-insert={dropItem?.id === item.id ? (dropItem.after ? 'after' : 'before') : undefined}
            onDragOver={event => { if (!draggedItem || busy) return; event.preventDefault(); const rect = event.currentTarget.getBoundingClientRect(); setDropItem({ id: item.id, after: event.clientY > rect.top + rect.height / 2 }) }}
            onDrop={event => { event.preventDefault(); if (draggedItem) { const rect = event.currentTarget.getBoundingClientRect(); moveItem(draggedItem, item.id, event.clientY > rect.top + rect.height / 2) } setDraggedItem(null); setDropItem(null) }}>
            <button type="button" className="tasks-checklist-drag" disabled={busy} draggable={!busy} aria-label={`拖动排序子项 ${item.title}`} title="拖动排序，或按 Alt + 上下方向键移动"
              onDragStart={event => { event.dataTransfer.setData('application/x-chouyu-checklist', item.id); event.dataTransfer.effectAllowed = 'move'; setDraggedItem(item.id) }}
              onDragEnd={() => { setDraggedItem(null); setDropItem(null) }}
              onKeyDown={event => { if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); const after = event.key === 'ArrowDown'; const target = items[index + (after ? 1 : -1)]; if (target) moveItem(item.id, target.id, after) }}><TaskIcon name="grip" /></button>
            <input type="checkbox" disabled={busy} aria-label={`完成子项 ${item.title}`} checked={item.done} onChange={event => patchItem(item.id, { done: event.target.checked })} />
            <input className="tasks-checklist-title" disabled={busy} aria-label="子项名称" maxLength={200} value={item.title}
              onChange={event => patchItem(item.id, { title: event.target.value })}
              onKeyDown={event => { if (event.key === 'Enter') event.preventDefault() }} />
            <TaskDateTimePicker label={`子项截止时间 ${item.title}`} value={toDateTimeLocal(item.dueAt)} disabled={busy}
              onChange={value => patchItem(item.id, { dueAt: itemDueAt(value), reminders: [] })} />
            <select className="tasks-checklist-remind" aria-label={`子项提醒 ${item.title}`} disabled={busy || item.dueAt == null} value={itemRemindChoice(item)}
              onChange={event => { const at = remindAtFromChoice(event.target.value as RemindChoiceId, item.dueAt ?? null); patchItem(item.id, at === null ? { reminders: [] } : { reminders: [{ at, firedAt: null }] }) }}>
              {REMIND_CHOICES.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
            </select>
            <button type="button" className="tasks-checklist-delete" disabled={busy} aria-label={`删除子项 ${item.title}`} onClick={() => onChange({ ...draft, checklist: draft.checklist!.filter(value => value.id !== item.id) })}>×</button>
          </div>)}
          </div>
        </section>
        {fields.length > 0 && <div className="tasks-composer-properties" role="group" aria-label="自定义字段">
          {fields.map(field => <div className="tasks-select-field" key={field.id}>
            <span>{field.name}</span>
            <TaskSelect label={`任务 ${field.name}`} value={draft.customFields[field.id] ?? ''} disabled={busy} onChange={value => onChange({ ...draft, customFields: { ...draft.customFields, [field.id]: value } })} options={[{ value: '', label: '未设置' }, ...field.options.map(option => ({ value: option.id, label: option.name }))]} />
          </div>)}
        </div>}
        <div className="tasks-form-actions"><span className="tasks-composer-hint">{draft.id ? "修改后保存即可更新任务" : "填写标题即可创建任务"}</span>
          <button type="button" disabled={busy} onClick={() => void requestClose()}>取消</button>
          <button type="submit" disabled={busy || !draft.title.trim() || !hasSelectedProject}>{busy ? '保存中…' : draft.id ? '保存' : '创建'}</button>
        </div>
          </form>
          {itemDialogOpen && <dialog ref={itemDialogRef} className="tasks-dialog tasks-subitem-dialog" aria-labelledby="tasks-subitem-title" onCancel={event => { event.preventDefault(); closeItemDialog() }} onKeyDown={event => event.stopPropagation()}>
            <header className="tasks-dialog-header"><h2 id="tasks-subitem-title">新增子项</h2></header>
            <form className="tasks-form" onSubmit={addItem}>
              <label>子项名称<input aria-label="新子项名称" autoFocus required maxLength={200} value={newItem} onChange={event => setNewItem(event.target.value)} /></label>
              <div className="tasks-select-field"><span>截止时间</span><TaskDateTimePicker label="新子项截止时间" value={newItemDue} onChange={value => { setNewItemDue(value); setNewItemRemind('none') }} /></div>
              <label>提醒<select aria-label="新子项提醒" disabled={!newItemDue} value={newItemRemind} onChange={event => setNewItemRemind(event.target.value as RemindChoiceId)}>{REMIND_CHOICES.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label>
              <div className="tasks-form-actions"><button type="button" onClick={closeItemDialog}>取消</button><button type="submit" disabled={busy || !newItem.trim()}>保存</button></div>
            </form>
          </dialog>}
        </div>
      </div>
}
