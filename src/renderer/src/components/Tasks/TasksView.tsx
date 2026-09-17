import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { RemindChoiceId, TaskDueRange, TaskPriority, TaskProject, TaskRecord, TaskSelectField, TaskSelectFieldUpdateInput, TaskSortMode, TaskView } from '../../../../shared/tasks'
import {
  DUE_RANGE_LABELS, PRIORITY_LABELS, RECURRENCE_LABELS, REMIND_CHOICES, TASK_SORT_LABELS, compareTasks, isDueThisWeek, isDueToday, isOverdue, matchesTaskView, remindAtFromChoice, sortTasks
} from '../../../../shared/tasks'
import TasksBoard, { type BoardGroupMode } from './TasksBoard'
import TaskFieldsDialog from './TaskFieldsDialog'
import TaskCardMeta, { TaskCardDue } from './TaskCardMeta'
import './Tasks.css'

type SmartView = 'today' | 'week' | 'overdue' | 'all' | 'done'
type Selection = SmartView | `project:${string}` | `view:${string}`

const SMART_VIEWS: { id: SmartView; label: string }[] = [
  { id: 'today', label: '今天' },
  { id: 'week', label: '本周' },
  { id: 'overdue', label: '过期' },
  { id: 'all', label: '全部' },
  { id: 'done', label: '已完成' }
]

interface Draft {
  id: string
  title: string
  note: string
  projectId: string
  priority: TaskPriority
  dueDate: string
  dueTime: string
  remind: RemindChoiceId
  recurrence: TaskRecord['recurrence']
  customFields: Record<string, string>
}

const emptyDraft: Draft = { id: '', title: '', note: '', projectId: '', priority: 'medium', dueDate: '', dueTime: '09:00', remind: 'due', recurrence: 'none', customFields: {} }

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
  dueDate: task.dueAt ? toInputDate(task.dueAt) : '',
  dueTime: task.dueAt ? new Date(task.dueAt).toTimeString().slice(0, 5) : '09:00',
  remind: remindChoiceFromTask(task), recurrence: task.recurrence, customFields: { ...task.customFields }
})
const dueLabel = (at: number): string =>
  new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(at)

export default function TasksView({ active, focusTaskId }: { active: boolean; focusTaskId?: string }) {
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
  const [newProject, setNewProject] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string; original: string } | null>(null)
  const [fieldsOpen, setFieldsOpen] = useState(false)
  const taskRefs = useRef<Record<string, HTMLLIElement | null>>({})

  const reload = useCallback(() => {
    const sequence = ++reloadSequence.current
    setLoading(true)
    void Promise.all([window.electronAPI.tasks.list({ doneLimit, doneQuery: selection === 'done' ? query : '', donePriorities: selection === 'done' ? filterPriorities : [] }), window.electronAPI.tasks.projects(), window.electronAPI.tasks.views(), window.electronAPI.tasks.fields()])
      .then(([list, projectList, viewList, fieldList]) => {
        if (sequence !== reloadSequence.current) return
        setTasks(list.open)
        setDoneTasks(list.done)
        setTotalDone(list.totalDone)
        setMatchedDone(list.matchedDone)
        setProjects(projectList)
        setViews(viewList)
        setFields(fieldList)
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
    if (!focusTaskId || !tasks.length) return
    const element = taskRefs.current[focusTaskId]
    if (!element) return
    element.scrollIntoView({ block: 'center' })
    element.focus({ preventScroll: true })
  }, [focusTaskId, tasks, selection])

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
    const dueAt = draftDueAt(draft)
    const remindAt = remindAtFromChoice(draft.remind, dueAt)
    const customFields = Object.fromEntries(fields.map(field => [field.id, draft.customFields[field.id] ?? null]))
    setBusy(true); setError('')
    const request = draft.id
      ? window.electronAPI.tasks.update(draft.id, { title, note: draft.note, projectId: draft.projectId || null, priority: draft.priority, dueAt, remindAt, recurrence: draft.recurrence, customFields })
      : window.electronAPI.tasks.create({ title, note: draft.note, projectId: draft.projectId || null, priority: draft.priority, dueAt, remindAt, recurrence: draft.recurrence, customFields })
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
    setNewProject(null)
    if (!name) return
    void window.electronAPI.tasks.createProject(name).then(reload).catch(reason => setError(String(reason)))
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
    const projectId = projects.some(project => project.id === candidate && !project.archivedAt) ? candidate : ''
    const dueDate = selection === 'today' || selection === 'week' || view?.dueRange === 'today' || view?.dueRange === 'week' ? toInputDate(Date.now()) : ''
    const priority = filterPriorities.length === 1 ? filterPriorities[0] : view?.priorities.length === 1 ? view.priorities[0] : emptyDraft.priority
    setError('')
    setDraft({ ...emptyDraft, projectId, dueDate, priority, customFields: {} })
  }
  const removeField = (field: TaskSelectField) => {
    if (groupFieldId === field.id) setGroupFieldId(null)
    void window.electronAPI.tasks.deleteField(field.id).then(reload).catch(reason => setError(String(reason)))
  }

  return <div className="tasks-view">
    <aside className="tasks-sidebar" aria-label="任务视图筛选">
      <ul role="list">
        {SMART_VIEWS.map(view => <li key={view.id}>
          <button type="button" aria-current={selection === view.id || undefined} onClick={() => setSelection(view.id)}>{view.label}<span className="tasks-count">{countFor(view.id)}</span></button>
        </li>)}
      </ul>
      <div className="tasks-sidebar-views">
        <h2>自定义视图</h2>
        <ul role="list">
          {views.map(view => {
            const id = `view:${view.id}` as Selection
            return <li key={view.id}>
              <button type="button" aria-current={selection === id || undefined} onClick={() => setSelection(id)}>{view.name}<span className="tasks-count">{countFor(id)}</span></button>
              <span className="tasks-project-actions">
                <button type="button" aria-label={`编辑视图 ${view.name}`} onClick={() => setViewDraft({ id: view.id, name: view.name, projectIds: [...view.projectIds], priorities: [...view.priorities], dueRange: view.dueRange })}>…</button>
                <button type="button" aria-label={`删除视图 ${view.name}`} onClick={() => removeView(view)}>删</button>
              </span>
            </li>
          })}
          <li><button type="button" className="tasks-new-project" onClick={() => setViewDraft({ ...emptyViewDraft })}>新建视图 +</button></li>
        </ul>
      </div>
      <div className="tasks-sidebar-projects">
        <h2>项目</h2>
        <ul role="list">
          {projects.filter(project => !project.archivedAt).map(project => {
            const id = `project:${project.id}` as Selection
            return <li key={project.id}>
              {renaming?.id === project.id
                ? <form className="tasks-new-project-form" onSubmit={submitRename}>
                    <input value={renaming.name} autoFocus aria-label={`重命名 ${project.name}`} placeholder="项目名称"
                      onChange={e => setRenaming({ ...renaming, name: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Escape') setRenaming(null) }} />
                    <button type="button" className="tasks-new-project-cancel" aria-label={`取消重命名 ${project.name}`} onClick={() => setRenaming(null)}>取消</button>
                  </form>
                : <>
                    <button type="button" aria-current={selection === id || undefined} onClick={() => setSelection(id)}>{project.name}<span className="tasks-count">{countFor(`project:${project.id}`)}</span></button>
                    <span className="tasks-project-actions"><button type="button" aria-label={`重命名 ${project.name}`} onClick={() => setRenaming({ id: project.id, name: project.name, original: project.name })}>…</button><button type="button" aria-label={`归档 ${project.name}`} onClick={() => archiveProject(project)}>归档</button></span>
                  </>}
            </li>
          })}
          {newProject === null
            ? <li><button type="button" className="tasks-new-project" onClick={() => setNewProject('')}>新建项目 +</button></li>
            : <li>
                <form className="tasks-new-project-form" onSubmit={submitProject}>
                  <input value={newProject} autoFocus aria-label="新项目名称" placeholder="项目名称"
                    onChange={e => setNewProject(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Escape') setNewProject(null) }} />
                  <button type="button" className="tasks-new-project-cancel" aria-label="取消新建项目" onClick={() => setNewProject(null)}>取消</button>
                </form>
              </li>}
        </ul>
        {projects.some(project => project.archivedAt) && <details className="tasks-archived">
          <summary title="归档只收起项目入口，未完成任务和提醒仍会保留">已归档项目</summary>
          <ul role="list">{projects.filter(project => project.archivedAt).map(project => <li key={project.id}>{project.name} <button type="button" onClick={() => void window.electronAPI.tasks.archiveProject(project.id, false).then(reload).catch(reason => setError(String(reason)))}>恢复</button></li>)}</ul>
        </details>}
      </div>
    </aside>

    <section className="tasks-main" aria-label="任务列表">
      {quarantineNotice && <p role="alert" className="tasks-quarantine">{quarantineNotice}</p>}
      {error && !draft && !viewDraft && !fieldsOpen && <p role="alert" className="tasks-error">{error}</p>}
      {notice && <p role="status" className="tasks-notice">{notice}<button type="button" aria-label="关闭提示" onClick={() => setNotice('')}>×</button></p>}
      {selection !== 'done' && <div className="tasks-tabs" role="group" aria-label="展示方式">
        <button type="button" className="tasks-tab" aria-pressed={mode === 'list'} onClick={() => setMode('list')}>列表</button>
        <button type="button" className="tasks-tab" aria-pressed={mode === 'board'} onClick={() => setMode('board')}>看板</button>
      </div>}
      <div className="tasks-toolbar">
        <div className="tasks-toolbar-group">
          <button type="button" className="tasks-create" onClick={startCreate}>新建任务</button>
          <p>{selection === 'done' ? `${matchedDone} 个匹配 · 共 ${totalDone} 个已完成` : `${visible.length} 个进行中${totalDone > 0 ? ` · ${totalDone} 个已完成` : ''}`}</p>
        </div>
        <div className="tasks-toolbar-group">
          {mode === 'board' && selection !== 'done' && <label className="tasks-group">分组
            <select value={groupMode === 'field' ? `field:${groupFieldId ?? ''}` : groupMode} aria-label="看板分组方式"
              onChange={e => {
                const value = e.target.value
                if (value.startsWith('field:')) { setGroupMode('field'); setGroupFieldId(value.slice('field:'.length) || null) }
                else { setGroupMode(value as BoardGroupMode); setGroupFieldId(null) }
              }}>
              <option value="priority">按优先级</option>
              <option value="project">按项目</option>
              {fields.map(field => <option key={field.id} value={`field:${field.id}`}>按{field.name}</option>)}
            </select>
          </label>}
          <details className="tasks-tool-menu">
            <summary aria-label="筛选任务">筛选{filterPriorities.length > 0 ? ` ·${filterPriorities.length}` : ''}</summary>
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
            <summary aria-label="排序方式">排序{sortMode !== 'smart' ? ` ·${TASK_SORT_LABELS[sortMode]}` : ''}</summary>
            <div className="tasks-item-menu-popover tasks-tool-popover" role="group" aria-label="排序方式">
              {(Object.keys(TASK_SORT_LABELS) as TaskSortMode[]).map(id => (
                <button key={id} type="button" aria-current={sortMode === id || undefined}
                  onClick={e => { setSortMode(id); e.currentTarget.closest('details')?.removeAttribute('open') }}>
                  {TASK_SORT_LABELS[id]}
                </button>
              ))}
            </div>
          </details>}
          <button type="button" className="tasks-fields-toggle" onClick={() => setFieldsOpen(true)}>字段</button>
          <label className="tasks-search"><span className="sr-only">搜索任务</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索任务或备注" />{query && <button type="button" aria-label="清空搜索" onClick={() => setQuery('')}>×</button>}</label>
        </div>
      </div>

      {(selection === 'done' ? doneVisible.length : visible.length) === 0 && !draft && !loading && <div className="tasks-empty">
        {selection === 'done'
          ? <><h2>{query.trim() ? '没有匹配的已完成任务' : '还没有已完成的任务'}</h2><p>{query.trim() ? '试试其他关键词，或清空搜索。' : '完成的任务会保留在这里，可随时恢复。'}</p></>
          : <><h2>{query.trim() ? '没有匹配的任务' : selection.startsWith('project:') ? '这个项目还没有任务' : selection.startsWith('view:') ? '这个视图还没有匹配的任务' : '这里没有待办任务'}</h2><p>{query.trim() ? '试试其他关键词，或清空搜索。' : '点击「新建任务」开始，支持截止日、提醒和优先级。'}</p></>}
      </div>}

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
            项目
            <select value={draft.projectId} onChange={e => setDraft({ ...draft, projectId: e.target.value })} aria-label="任务项目">
              <option value="">不归属项目</option>
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
              {projects.filter(project => !project.archivedAt).length > 0 && <div className="tasks-view-checks" role="group" aria-label="视图项目">
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
      {selection === 'done'
        ? <ul role="list" className="tasks-list tasks-list-done" aria-label="已完成任务">
        {doneVisible.map(task => <li key={task.id} className="tasks-item" data-priority={task.priority}>
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
              <TaskCardDue task={task} />
              <details className="tasks-item-menu">
                <summary aria-label={`更多操作 ${task.title}`} title="更多操作">…</summary>
                <div className="tasks-item-menu-popover">
                  <button type="button" onClick={() => setDraft(draftFromTask(task))}>编辑任务</button>
                  <button type="button" className="tasks-item-menu-danger" onClick={() => remove(task.id)}>删除任务</button>
                </div>
              </details>
            </div>
            {task.note && <p className="tasks-item-note" title={task.note}>{task.note}</p>}
            <TaskCardMeta task={task} projects={projects} fields={fields} />
          </div>
        </li>)}
      </ul>}
      {selection === 'done' && doneTasks.length < matchedDone && <button className="tasks-load-more" type="button" disabled={loading} onClick={() => setDoneLimit(limit => limit + 50)}>加载更多（已加载 {doneTasks.length} / {matchedDone}）</button>}
    </section>
  </div>
}
