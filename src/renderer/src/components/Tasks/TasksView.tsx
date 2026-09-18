import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { RemindChoiceId, TaskDueRange, TaskGroup, TaskPriority, TaskProject, TaskRecord, TaskSelectField, TaskSelectFieldUpdateInput, TaskSortMode, TaskView } from '../../../../shared/tasks'
import {
  DUE_RANGE_LABELS, PRIORITY_LABELS, RECURRENCE_LABELS, REMIND_CHOICES, TASK_SORT_LABELS, compareTasks, isUnplanned, isDueThisWeek, isDueToday, isOverdue, matchesTaskView, remindAtFromChoice, sortTasks
} from '../../../../shared/tasks'
import TasksBoard, { type BoardGroupMode } from './TasksBoard'
import TaskFieldsDialog from './TaskFieldsDialog'
import TaskCollectionDialog from './TaskCollectionDialog'
import TaskCardMeta, { TaskCardDue } from './TaskCardMeta'
import TaskIcon, { type IconName } from './TaskIcon'
import useTaskMenus from './useTaskMenus'
import './Tasks.css'

type SmartView = 'unplanned' | 'today' | 'week' | 'overdue' | 'all' | 'done'
type Selection = SmartView | `project:${string}` | `view:${string}`

const SMART_VIEWS: { id: SmartView; label: string }[] = [
  { id: 'today', label: '今天' },
  { id: 'week', label: '本周' },
  { id: 'unplanned', label: '待规划' },
  { id: 'all', label: '全部' },
  { id: 'overdue', label: '过期' },
  { id: 'done', label: '已完成' }
]

const SMART_ICONS: Record<SmartView, IconName> = { today: 'today', week: 'week', overdue: 'clock', unplanned: 'unplanned', all: 'all', done: 'done' }

interface Draft {
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

const emptyDraft: Draft = { id: '', title: '', note: '', projectId: '', priority: 'medium', startDate: '', startTime: '09:00', dueDate: '', dueTime: '09:00', remind: 'due', recurrence: 'none', customFields: {} }

interface ViewDraft {
  id: string
  name: string
  projectIds: string[]
  priorities: TaskPriority[]
  dueRange: TaskDueRange
}

const emptyViewDraft: ViewDraft = { id: '', name: '', projectIds: [], priorities: [], dueRange: 'any' }

const toInputDate = (at: number): string => {
  const date = new Date(at)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const draftDueAt = (draft: Draft): number | null => {
  if (!draft.dueDate) return null
  return new Date(`${draft.dueDate}T${draft.dueTime || '09:00'}`).getTime() || null
}
const remindChoiceFromTask = (task: TaskRecord): RemindChoiceId => {
  if (task.remindAt === null || task.dueAt === null) return 'none'
  for (const choice of REMIND_CHOICES) {
    if (remindAtFromChoice(choice.id, task.dueAt) === task.remindAt) return choice.id
  }
  return 'none'
}
const draftFromTask = (task: TaskRecord): Draft => ({
  id: task.id,
  title: task.title,
  note: task.note,
  projectId: task.projectId ?? '',
  priority: task.priority,
  startDate: task.startAt != null ? toInputDate(task.startAt) : '',
  startTime: task.startAt != null ? new Date(task.startAt).toTimeString().slice(0, 5) : '09:00',
  dueDate: task.dueAt ? toInputDate(task.dueAt) : '',
  dueTime: task.dueAt ? new Date(task.dueAt).toTimeString().slice(0, 5) : '09:00',
  remind: remindChoiceFromTask(task), recurrence: task.recurrence, customFields: { ...task.customFields }
})
const dueLabel = (at: number): string =>
  new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(at)

export default function TasksView({ active, focusTaskId, searchRequest }: { active: boolean; focusTaskId?: string; searchRequest?: { id: string; done: boolean; query: string; nonce: number } }) {
  const menusRef = useTaskMenus(active)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const sidebarToggleRef = useRef<HTMLButtonElement>(null)
  const toggleSidebar = () => {
    setSidebarCollapsed(value => !value)
    requestAnimationFrame(() => sidebarToggleRef.current?.focus())
  }
  const [visibleViewCount, setVisibleViewCount] = useState(4)
  useEffect(() => {
    const sidebar = menusRef.current?.querySelector<HTMLElement>('.tasks-sidebar')
    if (!sidebar || !active || sidebarCollapsed) return
    const update = () => {
      const headerHeight = sidebar.querySelector('header')?.getBoundingClientRect().height ?? 44
      const height = sidebar.clientHeight
      const budget = Math.max(0, Math.min(height * .52, height - headerHeight - 120) - 44)
      setVisibleViewCount(window.innerWidth <= 640 ? 3 : Math.min(SMART_VIEWS.length, Math.floor(budget / 38)))
    }
    const observer = new ResizeObserver(update)
    observer.observe(sidebar)
    update()
    return () => observer.disconnect()
  }, [active, sidebarCollapsed, menusRef])
  const [selection, setSelection] = useState<Selection>('today')
  const [query, setQuery] = useState('')
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [doneTasks, setDoneTasks] = useState<TaskRecord[]>([])
  const [totalDone, setTotalDone] = useState(0)
  const [matchedDone, setMatchedDone] = useState(0)
  const [doneLimit, setDoneLimit] = useState(50)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('')
  const reloadSequence = useRef(0)
  const [projects, setProjects] = useState<TaskProject[]>([])
  const [views, setViews] = useState<TaskView[]>([])
  const [fields, setFields] = useState<TaskSelectField[]>([])
  const [mode, setMode] = useState<'list' | 'board'>('list')
  const [groupMode, setGroupMode] = useState<BoardGroupMode>('priority')
  const [groupFieldId, setGroupFieldId] = useState<string | null>(null)
  const [viewDraft, setViewDraft] = useState<ViewDraft | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sortMode, setSortMode] = useState<TaskSortMode>('smart')
  const [filterPriorities, setFilterPriorities] = useState<TaskPriority[]>([])
  const [quarantineNotice, setQuarantineNotice] = useState('')
  const [groups, setGroups] = useState<TaskGroup[]>([])
  const [groupRenaming, setGroupRenaming] = useState<TaskGroup | null>(null)
  const [newGroup, setNewGroup] = useState<string | null>(null)
  const [projectGroupId, setProjectGroupId] = useState('')
  const [projectBusy, setProjectBusy] = useState(false)
  const [newProject, setNewProject] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string; original: string } | null>(null)
  const [fieldsOpen, setFieldsOpen] = useState(false)
  const taskRefs = useRef<Record<string, HTMLLIElement | null>>({})

  const reload = useCallback(() => {
    const sequence = ++reloadSequence.current
    setLoading(true)
    void Promise.all([window.electronAPI.tasks.list({ doneLimit, doneQuery: selection === 'done' ? query : '', donePriorities: selection === 'done' ? filterPriorities : [] }), window.electronAPI.tasks.projects(), window.electronAPI.tasks.views(), window.electronAPI.tasks.fields(), window.electronAPI.tasks.groups()])
      .then(([list, projectList, viewList, fieldList, groupList]) => {
        if (sequence !== reloadSequence.current) return
        setTasks(list.open)
        setDoneTasks(list.done)
        setTotalDone(list.totalDone)
        setMatchedDone(list.matchedDone)
        setProjects(projectList)
        setViews(viewList)
        setFields(fieldList)
        setGroups(groupList)
        window.dispatchEvent(new Event('chouyu:tasks-changed'))
        setQuarantineNotice(list.quarantinedAt ? '任务数据文件曾无法读取，已重建空库，原文件已隔离保存。' : '')
      })
      .catch(reason => { if (sequence === reloadSequence.current) setError(String(reason)) })
      .finally(() => { if (sequence === reloadSequence.current) setLoading(false) })
  }, [doneLimit, query, filterPriorities, selection])

  useEffect(() => {
    if (!active) return
    const timer = setTimeout(reload, 100)
    return () => { clearTimeout(timer); reloadSequence.current += 1 }
  }, [active, reload])
  useEffect(() => { setDoneLimit(50) }, [query, filterPriorities, selection])
  useEffect(() => {
    if (!draft && !viewDraft && !fieldsOpen) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setDraft(null); setViewDraft(null); setFieldsOpen(false) } }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [draft, viewDraft, fieldsOpen])
  useEffect(() => { if (focusTaskId) { setSelection('all'); setQuery(''); setFilterPriorities([]); setMode('list') } }, [focusTaskId])
  useEffect(() => {
    if (!searchRequest) return
    setSelection(searchRequest.done ? 'done' : 'all'); setQuery(searchRequest.done ? searchRequest.query : ''); setFilterPriorities([]); setMode('list')
  }, [searchRequest])
  useEffect(() => {
    if (!active || !focusTaskId) return
    const element = taskRefs.current[focusTaskId]
    if (!element) return
    element.scrollIntoView({ block: 'center' })
    element.focus({ preventScroll: true })
  }, [active, focusTaskId, tasks, doneTasks, selection, searchRequest])

  const now = Date.now()
  const matchesSelection = (task: TaskRecord, target: Selection): boolean => {
    if (target.startsWith('project:')) return task.projectId === target.slice('project:'.length)
    if (target.startsWith('view:')) {
      const view = views.find(item => item.id === target.slice('view:'.length))
      return view ? matchesTaskView(task, view, now) : false
    }
    if (target === 'today') return isDueToday(task, now)
    if (target === 'week') return isDueThisWeek(task, now)
    if (target === 'overdue') return isOverdue(task, now)
    if (target === 'unplanned') return isUnplanned(task)
    if (target === 'done') return false
    return true
  }
  const keyword = query.trim().toLocaleLowerCase()
  const matchesKeywordAndFilter = (task: TaskRecord): boolean =>
    (!keyword || `${task.title} ${task.note}`.toLocaleLowerCase().includes(keyword)) &&
    (filterPriorities.length === 0 || filterPriorities.includes(task.priority))
  const visible = tasks.filter(task => matchesKeywordAndFilter(task) && matchesSelection(task, selection))
    .sort((a, b) => compareTasks(a, b, now))
  const sorted = sortTasks(visible, sortMode, now)
  const doneVisible = selection === 'done' ? doneTasks.filter(matchesKeywordAndFilter) : []
  const countFor = (target: Selection) => target === 'done' ? totalDone : tasks.filter(task => matchesSelection(task, target)).length
  const boardGroupMode: BoardGroupMode = groupMode === 'field' && !fields.some(field => field.id === groupFieldId) ? 'priority' : groupMode

  const submitDraft = (event: FormEvent) => {
    event.preventDefault()
    if (!draft) return
    const title = draft.title.trim()
    if (!title) { setError('任务标题不能为空。'); return }
    const startAt = draft.startDate ? new Date(`${draft.startDate}T${draft.startTime || '09:00'}`).getTime() : null
    const dueAt = draftDueAt(draft)
    if (startAt !== null && dueAt !== null && startAt > dueAt) { setError('开始时间不能晚于截止时间。'); return }
    const remindAt = remindAtFromChoice(draft.remind, dueAt)
    const customFields = Object.fromEntries(fields.map(field => [field.id, draft.customFields[field.id] ?? null]))
    setBusy(true); setError('')
    const request = draft.id
      ? window.electronAPI.tasks.update(draft.id, { title, note: draft.note, projectId: draft.projectId || null, priority: draft.priority, startAt, dueAt, remindAt, recurrence: draft.recurrence, customFields })
      : window.electronAPI.tasks.create({ title, note: draft.note, projectId: draft.projectId || null, priority: draft.priority, startAt, dueAt, remindAt, recurrence: draft.recurrence, customFields })
    void request
      .then(saved => {
        setDraft(null)
        if (selection === 'done' || !matchesSelection(saved, selection) || !matchesKeywordAndFilter(saved)) {
          setSelection('all'); setQuery(''); setFilterPriorities([])
          setNotice('任务已保存，已切换到全部任务。')
        } else setNotice(draft.id ? '任务已保存。' : '任务已创建。')
        reload()
      })
      .catch(reason => setError(String(reason)))
      .finally(() => setBusy(false))
  }

  const complete = (id: string) => {
    void window.electronAPI.tasks.complete(id).then(reload).catch(reason => setError(String(reason)))
  }
  const remove = (id: string) => {
    if (!window.confirm('删除这个任务？此操作无法撤销。')) return
    void window.electronAPI.tasks.remove(id).then(reload).catch(reason => setError(String(reason)))
  }
  const archiveProject = (project: TaskProject) => {
    void window.electronAPI.tasks.archiveProject(project.id, true).then(() => {
      if (selection === `project:${project.id}`) setSelection('all')
      setNotice(`「${project.name}」已归档，未完成任务和提醒仍会保留。`)
      reload()
    }).catch(reason => setError(String(reason)))
  }
  const submitProject = (event: FormEvent) => {
    event.preventDefault()
    const name = newProject?.trim()
    if (!name || projectBusy) return
    setProjectBusy(true); setError('')
    void window.electronAPI.tasks.createProject(name, projectGroupId || null)
      .then(() => { setNewProject(null); reload() })
      .catch(reason => setError(String(reason))).finally(() => setProjectBusy(false))
  }
  const submitGroup = (event: FormEvent) => {
    event.preventDefault()
    if (!newGroup?.trim() || projectBusy) return
    setProjectBusy(true); setError('')
    void window.electronAPI.tasks.createGroup(newGroup.trim())
      .then(() => { setNewGroup(null); reload() })
      .catch(reason => setError(String(reason))).finally(() => setProjectBusy(false))
  }

  const submitGroupRename = (event: FormEvent) => {
    event.preventDefault()
    if (!groupRenaming?.name.trim() || projectBusy) return
    setProjectBusy(true); setError('')
    void window.electronAPI.tasks.renameGroup(groupRenaming.id, groupRenaming.name.trim())
      .then(() => { setGroupRenaming(null); reload() })
      .catch(reason => setError(String(reason))).finally(() => setProjectBusy(false))
  }
  const removeGroup = (group: TaskGroup) => {
    if (!window.confirm(`删除分组「${group.name}」？其中的清单和任务会保留，清单将移到默认分组。`)) return
    void window.electronAPI.tasks.deleteGroup(group.id).then(reload).catch(reason => setError(String(reason)))
  }
  const startGroupProject = (group: TaskGroup) => {
    setProjectGroupId(group.id); setNewProject(''); setNewGroup(null); setGroupRenaming(null); setError('')
  }

  const submitRename = (event: FormEvent) => {
    event.preventDefault()
    const target = renaming
    setRenaming(null)
    const name = target?.name.trim()
    if (!target || !name || name === target.original) return
    void window.electronAPI.tasks.renameProject(target.id, name).then(reload).catch(reason => setError(String(reason)))
  }
  const submitViewDraft = (event: FormEvent) => {
    event.preventDefault()
    if (!viewDraft) return
    const name = viewDraft.name.trim()
    if (!name) { setError('视图名称不能为空。'); return }
    const input = { name, projectIds: viewDraft.projectIds, priorities: viewDraft.priorities, dueRange: viewDraft.dueRange }
    setBusy(true); setError('')
    const request = viewDraft.id
      ? window.electronAPI.tasks.updateView(viewDraft.id, input)
      : window.electronAPI.tasks.createView(input)
    void request
      .then(() => { setViewDraft(null); reload() })
      .catch(reason => setError(String(reason)))
      .finally(() => setBusy(false))
  }
  const removeView = (view: TaskView) => {
    if (!window.confirm(`删除视图「${view.name}」？任务本身不受影响。`)) return
    if (selection === `view:${view.id}`) setSelection('today')
    void window.electronAPI.tasks.deleteView(view.id).then(reload).catch(reason => setError(String(reason)))
  }
  const saveField = async (id: string | null, input: TaskSelectFieldUpdateInput): Promise<TaskSelectField> => {
    setBusy(true); setError('')
    try {
      const saved = id
        ? await window.electronAPI.tasks.updateField(id, input)
        : await window.electronAPI.tasks.createField({ name: input.name ?? '', options: input.options?.map(option => typeof option === 'string' ? option : option.name) })
      reload()
      setNotice('字段已保存。')
      return saved
    } catch (reason) {
      setError(String(reason))
      throw reason
    } finally { setBusy(false) }
  }
  const startCreate = () => {
    const view = selection.startsWith('view:') ? views.find(item => item.id === selection.slice(5)) : undefined
    const candidate = selection.startsWith('project:') ? selection.slice(8) : view?.projectIds.length === 1 ? view.projectIds[0] : ''
    const projectId = projects.some(project => project.id === candidate && !project.archivedAt) ? candidate : projects.find(project => project.isDefault)?.id ?? ''
    const dueDate = selection === 'today' || selection === 'week' || view?.dueRange === 'today' || view?.dueRange === 'week' ? toInputDate(Date.now()) : ''
    const priority = filterPriorities.length === 1 ? filterPriorities[0] : view?.priorities.length === 1 ? view.priorities[0] : emptyDraft.priority
    setError('')
    setDraft({ ...emptyDraft, projectId, dueDate, priority, customFields: {} })
  }
  const removeField = (field: TaskSelectField) => {
    if (groupFieldId === field.id) setGroupFieldId(null)
    void window.electronAPI.tasks.deleteField(field.id).then(reload).catch(reason => setError(String(reason)))
  }

  const startNewGroup = () => { setNewGroup(''); setNewProject(null); setGroupRenaming(null); setError('') }
  const closeCollectionDialog = () => { setNewGroup(null); setNewProject(null); setGroupRenaming(null); setError('') }
  const collectionDialogOpen = newGroup !== null || newProject !== null || groupRenaming !== null

  const renderProject = (project: TaskProject) => {
    const id = `project:${project.id}` as Selection
    return <li key={project.id} className={`tasks-nav-row${project.isDefault ? ' tasks-inbox-row' : ''}`} data-selected={selection === id || undefined}>
      {renaming?.id === project.id
        ? <form className="tasks-new-project-form" onSubmit={submitRename}>
            <input value={renaming.name} autoFocus aria-label={`重命名 ${project.name}`} placeholder="清单名称"
              onChange={e => setRenaming({ ...renaming, name: e.target.value })}
              onKeyDown={e => { if (e.key === 'Escape') setRenaming(null) }} />
            <button type="button" className="tasks-new-project-cancel" aria-label={`取消重命名 ${project.name}`} onClick={() => setRenaming(null)}>取消</button>
          </form>
        : <>

            <button type="button" className="tasks-project-select" aria-current={selection === id || undefined} onClick={() => setSelection(id)} title={project.name}><TaskIcon name="task" /><span className="tasks-nav-label">{project.name}</span></button>
            <details className="tasks-project-menu">
              <summary aria-label={`管理清单 ${project.name}`} title="管理清单"><TaskIcon name="more" /></summary>
              <div className="tasks-item-menu-popover">
                <button type="button" aria-label={`重命名 ${project.name}`} onClick={() => setRenaming({ id: project.id, name: project.name, original: project.name })}><TaskIcon name="edit" />重命名</button>
                {!project.isDefault && <><label>移至分组<select aria-label={`移动清单 ${project.name} 到分组`} value={project.groupId ?? ''} onChange={e => void window.electronAPI.tasks.moveProject(project.id, e.target.value || null).then(reload).catch(reason => setError(String(reason)))}>
                  {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select></label>
                <button type="button" aria-label={`归档 ${project.name}`} onClick={() => archiveProject(project)}><TaskIcon name="archive" />归档清单</button></>}
              </div>
            </details>
          </>}
    </li>
  }
  const selectionTitle = SMART_VIEWS.find(view => view.id === selection)?.label
    ?? (selection.startsWith('project:') ? projects.find(project => project.id === selection.slice(8))?.name : views.find(view => view.id === selection.slice(5))?.name)
    ?? '任务'

  const visibleSmartViews = SMART_VIEWS.slice(0, visibleViewCount)
  const hiddenSmartViews = SMART_VIEWS.slice(visibleViewCount)
  const hiddenViewSelected = selection.startsWith('view:') || hiddenSmartViews.some(view => view.id === selection)

  return <div className="tasks-view" ref={menusRef}>
    <aside id="tasks-sidebar" className="tasks-sidebar" aria-label="任务视图筛选" hidden={sidebarCollapsed}>
      <header className="tasks-sidebar-title"><button ref={sidebarCollapsed ? undefined : sidebarToggleRef} type="button" className="tasks-sidebar-toggle" aria-label="收起任务侧栏" title="收起任务侧栏" aria-expanded="true" aria-controls="tasks-sidebar" onClick={toggleSidebar}><TaskIcon name="collapse" /></button><span>任务</span></header>
      <div className="tasks-sidebar-view-nav" role="region" aria-label="视图选择">
        <ul role="list" className="tasks-smart-views">
          {visibleSmartViews.map(view => <li key={view.id}>
            <button type="button" data-view-selection={view.id} aria-current={selection === view.id || undefined} onClick={() => setSelection(view.id)}><TaskIcon name={SMART_ICONS[view.id]} /><span className="tasks-nav-label">{view.label}</span><span className="tasks-count">{countFor(view.id)}</span></button>
          </li>)}
        </ul>
        <details className="tasks-tool-menu tasks-more-views">
          <summary aria-label="更多视图" title={hiddenViewSelected ? `${selectionTitle} · 更多视图` : '更多视图'} data-active={hiddenViewSelected || undefined}><TaskIcon name="more" /><span className="tasks-nav-label">{hiddenViewSelected ? selectionTitle : '更多视图'}</span><TaskIcon name="chevron" /></summary>
          <div className="tasks-item-menu-popover tasks-more-views-popover" role="group" aria-label="更多视图选择">
            {hiddenSmartViews.map(view => <button key={view.id} type="button" data-view-selection={view.id} aria-current={selection === view.id || undefined} onClick={() => setSelection(view.id)}><TaskIcon name={SMART_ICONS[view.id]} /><span className="tasks-nav-label">{view.label}</span><span className="tasks-count">{countFor(view.id)}</span></button>)}
            {views.length > 0 && <p className="tasks-tool-title">自定义视图</p>}
            {views.map(view => {
              const id = `view:${view.id}` as Selection
              return <div className="tasks-more-view-row" key={view.id}>
                <button type="button" data-view-selection={id} aria-current={selection === id || undefined} onClick={() => setSelection(id)} title={view.name}><TaskIcon name="filter" /><span className="tasks-nav-label">{view.name}</span><span className="tasks-count">{countFor(id)}</span></button>
                <button type="button" className="tasks-more-view-action" aria-label={`编辑视图 ${view.name}`} title="编辑视图" onClick={() => setViewDraft({ id: view.id, name: view.name, projectIds: [...view.projectIds], priorities: [...view.priorities], dueRange: view.dueRange })}><TaskIcon name="edit" /></button>
                <button type="button" className="tasks-more-view-action tasks-item-menu-danger" aria-label={`删除视图 ${view.name}`} title="删除视图" onClick={() => removeView(view)}><TaskIcon name="trash" /></button>
              </div>
            })}
            <button type="button" className="tasks-more-view-create" onClick={() => setViewDraft({ ...emptyViewDraft })}><TaskIcon name="plus" />新建自定义视图</button>
          </div>
        </details>
      </div>
      <div className="tasks-sidebar-projects" role="region" aria-label="分组和清单列表">
        {groups.map(group => <div className="tasks-group-shell" key={group.id}>
          <details className="tasks-project-group" open>
            <summary aria-label={`折叠或展开分组 ${group.name}`}><span className="tasks-group-chevron"><TaskIcon name="chevron" /></span><span>{group.name}</span></summary>
            <ul role="list">{projects.filter(project => !project.archivedAt && project.groupId === group.id).sort((a, b) => Number(Boolean(b.isDefault)) - Number(Boolean(a.isDefault))).map(renderProject)}</ul>
          </details>
          <div className="tasks-group-actions">
            <details className="tasks-project-menu">
              <summary aria-label={`管理分组 ${group.name}`} title="管理分组"><TaskIcon name="more" /></summary>
              <div className="tasks-item-menu-popover">
                <button type="button" onClick={() => { setGroupRenaming({ ...group }); setNewGroup(null); setNewProject(null); setError('') }}><TaskIcon name="edit" />重命名</button>
                {!group.isDefault && <button type="button" className="tasks-item-menu-danger" onClick={() => removeGroup(group)}><TaskIcon name="trash" />删除分组</button>}
              </div>
            </details>
            {group.isDefault ? <details className="tasks-tool-menu tasks-add-list-menu">
              <summary aria-label="新建分组或清单" title="新建分组或清单"><TaskIcon name="plus" /></summary>
              <div className="tasks-item-menu-popover">
                <button type="button" onClick={startNewGroup}><TaskIcon name="folder" />新建分组</button>
                <button type="button" onClick={() => startGroupProject(group)}><TaskIcon name="task" />新建清单</button>
              </div>
            </details> : <button type="button" className="tasks-group-add" aria-label={`在 ${group.name} 中新建清单`} title="新建清单" onClick={() => startGroupProject(group)}><TaskIcon name="plus" /></button>}
          </div>
        </div>)}
        {projects.some(project => project.archivedAt) && <details className="tasks-archived">
          <summary title="归档只收起清单入口，未完成任务和提醒仍会保留">已归档清单</summary>
          <ul role="list">{projects.filter(project => project.archivedAt).map(project => <li key={project.id}>{project.name} <button type="button" onClick={() => void window.electronAPI.tasks.archiveProject(project.id, false).then(reload).catch(reason => setError(String(reason)))}>恢复</button></li>)}</ul>
        </details>}
      </div>
    </aside>

    <section className="tasks-main" aria-label="任务列表">
      {quarantineNotice && <p role="alert" className="tasks-quarantine">{quarantineNotice}</p>}
      {error && !draft && !viewDraft && !fieldsOpen && !collectionDialogOpen && <p role="alert" className="tasks-error">{error}</p>}
      {notice && <p role="status" className="tasks-notice">{notice}<button type="button" aria-label="关闭提示" onClick={() => setNotice('')}>×</button></p>}
      <header className="tasks-page-heading">
        {sidebarCollapsed && <button ref={sidebarToggleRef} type="button" className="tasks-sidebar-toggle" aria-label="展开任务侧栏" title="展开任务侧栏" aria-expanded="false" aria-controls="tasks-sidebar" onClick={toggleSidebar}><TaskIcon name="expand" /></button>}
        <span className="tasks-heading-icon"><TaskIcon name="task" /></span><h1>{selectionTitle}</h1>
        <details className="tasks-tool-menu tasks-heading-menu">
          <summary aria-label="任务视图选项" title="任务视图选项"><TaskIcon name="more" /></summary>
          <div className="tasks-item-menu-popover">
            <button type="button" onClick={e => { setViewDraft({ ...emptyViewDraft }); e.currentTarget.closest('details')?.removeAttribute('open') }}>新建自定义视图</button>
            <button type="button" onClick={e => { setFieldsOpen(true); e.currentTarget.closest('details')?.removeAttribute('open') }}>管理字段</button>
          </div>
        </details>
      </header>
      {selection !== 'done' && <div className="tasks-tabs" role="group" aria-label="展示方式">
        <button type="button" className="tasks-tab" aria-pressed={mode === 'list'} onClick={() => setMode('list')}><TaskIcon name="list" />列表</button>
        <button type="button" className="tasks-tab" aria-pressed={mode === 'board'} onClick={() => setMode('board')}><TaskIcon name="board" />看板</button>
      </div>}
      <div className="tasks-toolbar">
        <div className="tasks-toolbar-group">
          <div className="tasks-create-split">
            <button type="button" className="tasks-create" onClick={startCreate}><TaskIcon name="plus" />新建任务</button>
            <details className="tasks-tool-menu tasks-create-options">
              <summary aria-label="新建任务选项" title="新建任务选项"><TaskIcon name="chevron" /></summary>
              <div className="tasks-item-menu-popover">
                <p className="tasks-tool-title">选择优先级新建</p>
                {(['high', 'medium', 'low'] as TaskPriority[]).map(priority => <button type="button" key={priority} onClick={e => { startCreate(); setDraft(current => current ? { ...current, priority } : current); e.currentTarget.closest('details')?.removeAttribute('open') }}>{PRIORITY_LABELS[priority]}优先级任务</button>)}
              </div>
            </details>
          </div>
          {mode === 'board' && selection !== 'done' && <label className="tasks-group" title="看板分组方式"><TaskIcon name="group" />
            <select value={groupMode === 'field' ? `field:${groupFieldId ?? ''}` : groupMode} aria-label="看板分组方式"
              onChange={e => {
                const value = e.target.value
                if (value.startsWith('field:')) { setGroupMode('field'); setGroupFieldId(value.slice('field:'.length) || null) }
                else { setGroupMode(value as BoardGroupMode); setGroupFieldId(null) }
              }}>
              <option value="priority">按优先级</option>
              <option value="project">按清单</option>
              {fields.map(field => <option key={field.id} value={`field:${field.id}`}>按{field.name}</option>)}
            </select>
          </label>}
          <details className="tasks-tool-menu">
            <summary aria-label="筛选任务" title="筛选任务" data-active={filterPriorities.length > 0 || undefined}><TaskIcon name="filter" />{filterPriorities.length > 0 && <span className="tasks-tool-badge">{filterPriorities.length}</span>}</summary>
            <div className="tasks-item-menu-popover tasks-tool-popover" role="group" aria-label="筛选优先级">
              <p className="tasks-tool-title">优先级</p>
              {(['high', 'medium', 'low'] as TaskPriority[]).map(priority => (
                <label key={priority} className="tasks-view-check">
                  <input type="checkbox" checked={filterPriorities.includes(priority)}
                    onChange={e => setFilterPriorities(e.target.checked ? [...filterPriorities, priority] : filterPriorities.filter(item => item !== priority))} />
                  {PRIORITY_LABELS[priority]}
                </label>
              ))}
              {filterPriorities.length > 0 && <button type="button" onClick={() => setFilterPriorities([])}>清除筛选</button>}
            </div>
          </details>
          {selection !== 'done' && <details className="tasks-tool-menu">
            <summary aria-label="排序方式" title={`排序：${TASK_SORT_LABELS[sortMode]}`} data-active={sortMode !== 'smart' || undefined}><TaskIcon name="sort" /></summary>
            <div className="tasks-item-menu-popover tasks-tool-popover" role="group" aria-label="排序方式">
              {(Object.keys(TASK_SORT_LABELS) as TaskSortMode[]).map(id => (
                <button key={id} type="button" aria-current={sortMode === id || undefined}
                  onClick={e => { setSortMode(id); e.currentTarget.closest('details')?.removeAttribute('open') }}>
                  {TASK_SORT_LABELS[id]}
                </button>
              ))}
            </div>
          </details>}
          <button type="button" className="tasks-fields-toggle" aria-label="管理字段" title="管理字段" onClick={() => setFieldsOpen(true)}><TaskIcon name="fields" /></button>
        </div>
        <div className="tasks-toolbar-group tasks-toolbar-end">
          <label className="tasks-search"><span className="sr-only">搜索任务</span><TaskIcon name="search" /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索任务或备注" />{query && <button type="button" aria-label="清空搜索" onClick={() => setQuery('')}>×</button>}</label>
        </div>
      </div>

      {(selection === 'done' ? doneVisible.length : visible.length) === 0 && !draft && !loading && <div className="tasks-empty">
        <span className="tasks-empty-icon"><TaskIcon name={selection === 'unplanned' ? 'unplanned' : 'task'} /></span>
        {selection === 'done'
          ? <><h2>{query.trim() ? '没有匹配的已完成任务' : '还没有已完成的任务'}</h2><p>{query.trim() ? '试试其他关键词，或清空搜索。' : '完成的任务会保留在这里，可随时恢复。'}</p></>
          : <><h2>{query.trim() ? '没有匹配的任务' : selection === 'unplanned' ? '没有待规划的任务' : selection.startsWith('project:') ? '这个清单还没有任务' : selection.startsWith('view:') ? '这个视图还没有匹配的任务' : '这里没有待办任务'}</h2><p>{query.trim() ? '试试其他关键词，或清空搜索。' : selection === 'unplanned' ? '未设置开始时间和截止时间的任务会显示在这里。' : '点击「新建任务」，记录下一件要做的事。'}</p></>}
      </div>}

      {collectionDialogOpen && <TaskCollectionDialog
        title={groupRenaming ? '重命名分组' : newProject !== null ? '新建清单' : '新建分组'}
        name={groupRenaming?.name ?? newProject ?? newGroup ?? ''}
        onNameChange={name => { if (groupRenaming) setGroupRenaming({ ...groupRenaming, name }); else if (newProject !== null) setNewProject(name); else setNewGroup(name) }}
        groups={newProject !== null ? groups : undefined} groupId={projectGroupId} onGroupChange={setProjectGroupId}
        busy={projectBusy} error={error} editing={Boolean(groupRenaming)}
        onSubmit={groupRenaming ? submitGroupRename : newProject !== null ? submitProject : submitGroup}
        onClose={closeCollectionDialog} />}

      {draft && <div className="tasks-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setDraft(null) }}>
        <div className="tasks-dialog" role="dialog" aria-modal="true" aria-labelledby="tasks-dialog-title" onMouseDown={event => event.stopPropagation()}>
          <header className="tasks-dialog-header">
            <h2 id="tasks-dialog-title">{draft.id ? '编辑任务' : '新建任务'}</h2>
            <button type="button" aria-label="关闭任务弹窗" onClick={() => setDraft(null)}>×</button>
          </header>
          <form className="tasks-form" onSubmit={submitDraft} aria-label={draft.id ? '编辑任务' : '新建任务'}>
        {error && <p role="alert" className="tasks-error">{error}</p>}
        <label>
          标题
          <input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })}
            onKeyDown={e => { if (e.key === 'Escape') setDraft(null) }}
            autoFocus aria-label="任务标题" placeholder="要做什么？" />
        </label>
        <label>
          备注
          <textarea value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })}
            onKeyDown={e => { if (e.key === 'Escape') setDraft(null) }}
            aria-label="任务备注" rows={2} />
        </label>
        <div className="tasks-form-row">
          <label>
            清单
            <select value={draft.projectId} onChange={e => setDraft({ ...draft, projectId: e.target.value })} aria-label="任务清单">

              {projects.filter(project => !project.archivedAt || project.id === draft.projectId).map(project =>
                <option key={project.id} value={project.id}>{project.name}{project.archivedAt ? '（已归档）' : ''}</option>)}
            </select>
          </label>
          <label>
            优先级
            <select value={draft.priority} onChange={e => setDraft({ ...draft, priority: e.target.value as TaskPriority })} aria-label="任务优先级">
              <option value="high">高</option>
              <option value="medium">中</option>
              <option value="low">低</option>
            </select>
          </label>
          <label>
            重复
            <select value={draft.recurrence} onChange={e => setDraft({ ...draft, recurrence: e.target.value as TaskRecord['recurrence'] })} disabled={!draft.dueDate} aria-label="任务重复规则">
              {(Object.keys(RECURRENCE_LABELS) as TaskRecord['recurrence'][]).map(id => <option key={id} value={id}>{RECURRENCE_LABELS[id]}</option>)}
            </select>
          </label>
        </div>
        <div className="tasks-form-row">
          <label>开始日期<input type="date" value={draft.startDate} onChange={e => setDraft({ ...draft, startDate: e.target.value })} aria-label="任务开始日期" /></label>
          <label>开始时间<input type="time" value={draft.startTime} onChange={e => setDraft({ ...draft, startTime: e.target.value })} aria-label="任务开始时间" disabled={!draft.startDate} /></label>
        </div>
        <div className="tasks-form-row">
          <label>
            截止日期
            <input type="date" value={draft.dueDate} onChange={e => setDraft({ ...draft, dueDate: e.target.value, ...(e.target.value ? {} : { recurrence: 'none' as const, remind: 'none' as const }) })} aria-label="任务截止日期" />
          </label>
          <label>
            时间
            <input type="time" value={draft.dueTime} onChange={e => setDraft({ ...draft, dueTime: e.target.value })} aria-label="任务截止时间" />
          </label>
          <label>
            提醒
            <select value={draft.remind} onChange={e => setDraft({ ...draft, remind: e.target.value as RemindChoiceId })}
              disabled={!draft.dueDate} aria-label="任务提醒">
              {REMIND_CHOICES.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
            </select>
          </label>
        </div>
        {fields.length > 0 && <div className="tasks-form-row" role="group" aria-label="自定义字段">
          {fields.map(field => <label key={field.id}>
            {field.name}
            <select value={draft.customFields[field.id] ?? ''} aria-label={`任务 ${field.name}`}
              onChange={e => setDraft({ ...draft, customFields: { ...draft.customFields, [field.id]: e.target.value } })}>
              <option value="">未设置</option>
              {field.options.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
          </label>)}
        </div>}
        <div className="tasks-form-actions">
          <button type="submit" disabled={busy}>{draft.id ? '保存' : '创建'}</button>
          <button type="button" onClick={() => setDraft(null)}>取消</button>
        </div>
          </form>
        </div>
      </div>}

      {viewDraft && <div className="tasks-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setViewDraft(null) }}>
        <div className="tasks-dialog" role="dialog" aria-modal="true" aria-labelledby="tasks-view-dialog-title" onMouseDown={event => event.stopPropagation()}>
          <header className="tasks-dialog-header">
            <h2 id="tasks-view-dialog-title">{viewDraft.id ? '编辑视图' : '新建视图'}</h2>
            <button type="button" aria-label="关闭视图弹窗" onClick={() => setViewDraft(null)}>×</button>
          </header>
          <form className="tasks-form" onSubmit={submitViewDraft} aria-label={viewDraft.id ? '编辑视图' : '新建视图'}>
            {error && <p role="alert" className="tasks-error">{error}</p>}
            <label>
              名称
              <input value={viewDraft.name} onChange={e => setViewDraft({ ...viewDraft, name: e.target.value })}
                onKeyDown={e => { if (e.key === 'Escape') setViewDraft(null) }}
                autoFocus aria-label="视图名称" placeholder="例如：高优跟进" />
            </label>
            <fieldset className="tasks-view-filters">
              <legend>筛选条件（不选即不限）</legend>
              <label>
                截止范围
                <select value={viewDraft.dueRange} onChange={e => setViewDraft({ ...viewDraft, dueRange: e.target.value as TaskDueRange })} aria-label="视图截止范围">
                  {(Object.keys(DUE_RANGE_LABELS) as TaskDueRange[]).map(id => <option key={id} value={id}>{DUE_RANGE_LABELS[id]}</option>)}
                </select>
              </label>
              <div className="tasks-view-checks" role="group" aria-label="视图优先级">
                {(['high', 'medium', 'low'] as TaskPriority[]).map(priority => (
                  <label key={priority} className="tasks-view-check">
                    <input type="checkbox" checked={viewDraft.priorities.includes(priority)}
                      onChange={e => setViewDraft({ ...viewDraft, priorities: e.target.checked ? [...viewDraft.priorities, priority] : viewDraft.priorities.filter(item => item !== priority) })} />
                    {PRIORITY_LABELS[priority]}
                  </label>
                ))}
              </div>
              {projects.filter(project => !project.archivedAt).length > 0 && <div className="tasks-view-checks" role="group" aria-label="视图清单">
                {projects.filter(project => !project.archivedAt).map(project => (
                  <label key={project.id} className="tasks-view-check">
                    <input type="checkbox" checked={viewDraft.projectIds.includes(project.id)}
                      onChange={e => setViewDraft({ ...viewDraft, projectIds: e.target.checked ? [...viewDraft.projectIds, project.id] : viewDraft.projectIds.filter(item => item !== project.id) })} />
                    {project.name}
                  </label>
                ))}
              </div>}
            </fieldset>
            <div className="tasks-form-actions">
              <button type="submit" disabled={busy}>{viewDraft.id ? '保存' : '创建'}</button>
              <button type="button" onClick={() => setViewDraft(null)}>取消</button>
            </div>
          </form>
        </div>
      </div>}

      {fieldsOpen && <TaskFieldsDialog fields={fields} busy={busy} error={error} onSave={saveField} onDelete={removeField} onClose={() => setFieldsOpen(false)} />}

      {loading && <p role="status">正在加载任务…</p>}
      {selection !== 'done' && mode === 'list' && sorted.length > 0 && <div className="tasks-list-heading" aria-hidden="true"><span>任务名称</span><span>开始时间</span><span>截止时间</span><span /></div>}
      {selection === 'done'
        ? <ul role="list" className="tasks-list tasks-list-done" aria-label="已完成任务">
        {doneVisible.map(task => <li key={task.id} ref={element => { taskRefs.current[task.id] = element }} tabIndex={task.id === focusTaskId ? -1 : undefined} className={`tasks-item${task.id === focusTaskId ? ' tasks-item-focused' : ''}`} data-priority={task.priority}>
          <span className="tasks-item-title tasks-item-done-title">{task.title}</span>
          <span className="tasks-item-meta">{task.completedAt ? dueLabel(task.completedAt) + ' 完成' : ''}</span>
          <button type="button" onClick={() => void window.electronAPI.tasks.reopen(task.id).then(reload).catch(reason => setError(String(reason)))}>恢复</button>
        </li>)}
      </ul>
        : mode === 'board'
        ? <TasksBoard tasks={sorted} projects={projects} fields={fields} groupMode={boardGroupMode} groupFieldId={groupFieldId}
            onEdit={task => setDraft(draftFromTask(task))}
            onComplete={complete}
            onMove={(id, patch) => void window.electronAPI.tasks.update(id, patch).then(reload).catch(reason => setError(String(reason)))} />
        : <ul role="list" className="tasks-list">
        {sorted.map(task => <li key={task.id} ref={element => { taskRefs.current[task.id] = element }} tabIndex={task.id === focusTaskId ? -1 : undefined} className={`tasks-item${task.id === focusTaskId ? ' tasks-item-focused' : ''}`} data-priority={task.priority}>
          <button type="button" className="tasks-complete" aria-label={`完成 ${task.title}`} onClick={() => complete(task.id)} />
          <div className="tasks-item-body">
            <div className="tasks-item-head">
              <button type="button" className="tasks-item-title tasks-title-button" onClick={() => setDraft(draftFromTask(task))}>{task.title}</button>
            </div>
            {task.note && <p className="tasks-item-note" title={task.note}>{task.note}</p>}
            <TaskCardMeta task={task} projects={projects} fields={fields} />
          </div>
          <span className="tasks-date-cell tasks-start-cell" title={task.startAt != null ? `开始时间：${dueLabel(task.startAt)}` : '未设置开始时间'}><span className="tasks-date-label">开始</span>{task.startAt != null ? dueLabel(task.startAt) : '—'}</span>
          <span className="tasks-date-cell tasks-due-cell"><span className="tasks-date-label">截止</span>{task.dueAt !== null ? <TaskCardDue task={task} /> : '—'}</span>
              <details className="tasks-item-menu">
                <summary aria-label={`更多操作 ${task.title}`} title="更多操作"><TaskIcon name="more" /></summary>
                <div className="tasks-item-menu-popover">
                  <button type="button" onClick={() => setDraft(draftFromTask(task))}>编辑任务</button>
                  <button type="button" className="tasks-item-menu-danger" onClick={() => remove(task.id)}>删除任务</button>
                </div>
              </details>
        </li>)}
      </ul>}
      {selection === 'done' && doneTasks.length < matchedDone && <button className="tasks-load-more" type="button" disabled={loading} onClick={() => setDoneLimit(limit => limit + 50)}>加载更多（已加载 {doneTasks.length} / {matchedDone}）</button>}
    </section>
  </div>
}
