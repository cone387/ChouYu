import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { RemindChoiceId, TaskDueRange, TaskPriority, TaskProject, TaskRecord, TaskView } from '../../../../shared/tasks'
import {
  DUE_RANGE_LABELS, PRIORITY_LABELS, RECURRENCE_LABELS, REMIND_CHOICES, compareTasks, isDueThisWeek, isDueToday, isOverdue, matchesTaskView, remindAtFromChoice
} from '../../../../shared/tasks'
import './Tasks.css'

type SmartView = 'today' | 'week' | 'overdue' | 'all'
type Selection = SmartView | `project:${string}` | `view:${string}`

const SMART_VIEWS: { id: SmartView; label: string }[] = [
  { id: 'today', label: '今天和过期' },
  { id: 'week', label: '本周' },
  { id: 'overdue', label: '过期' },
  { id: 'all', label: '全部' }
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
}

const emptyDraft: Draft = { id: '', title: '', note: '', projectId: '', priority: 'medium', dueDate: '', dueTime: '09:00', remind: 'due', recurrence: 'none' }

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
  remind: remindChoiceFromTask(task), recurrence: task.recurrence
})
const dueLabel = (at: number): string =>
  new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(at)

export default function TasksView({ active, focusTaskId }: { active: boolean; focusTaskId?: string }) {
  const [selection, setSelection] = useState<Selection>('today')
  const [query, setQuery] = useState('')
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [doneTasks, setDoneTasks] = useState<TaskRecord[]>([])
  const [totalDone, setTotalDone] = useState(0)
  const [projects, setProjects] = useState<TaskProject[]>([])
  const [views, setViews] = useState<TaskView[]>([])
  const [viewDraft, setViewDraft] = useState<ViewDraft | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [quarantineNotice, setQuarantineNotice] = useState('')
  const [newProject, setNewProject] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string; original: string } | null>(null)
  const taskRefs = useRef<Record<string, HTMLLIElement | null>>({})

  const reload = useCallback(() => {
    void Promise.all([window.electronAPI.tasks.list(), window.electronAPI.tasks.projects(), window.electronAPI.tasks.views()])
      .then(([list, projectList, viewList]) => {
        setTasks(list.open)
        setDoneTasks(list.done)
        setTotalDone(list.totalDone)
        setProjects(projectList)
        setViews(viewList)
        window.dispatchEvent(new Event('chouyu:tasks-changed'))
        setQuarantineNotice(list.quarantinedAt ? '任务数据文件曾无法读取，已重建空库，原文件已隔离保存。' : '')
      })
      .catch(reason => setError(String(reason)))
  }, [])

  useEffect(() => { if (active) reload() }, [active, reload])
  useEffect(() => {
    if (!draft && !viewDraft) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setDraft(null); setViewDraft(null) } }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [draft, viewDraft])
  useEffect(() => { if (focusTaskId) { setSelection('all'); setQuery('') } }, [focusTaskId])
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
    if (target === 'today') return isDueToday(task, now) || isOverdue(task, now)
    if (target === 'week') return isDueThisWeek(task, now)
    if (target === 'overdue') return isOverdue(task, now)
    return true
  }
  const keyword = query.trim().toLocaleLowerCase()
  const visible = tasks.filter(task =>
    (!keyword || `${task.title} ${task.note}`.toLocaleLowerCase().includes(keyword)) && matchesSelection(task, selection))
    .sort((a, b) => compareTasks(a, b, now))
  const countFor = (target: Selection) => tasks.filter(task => matchesSelection(task, target)).length

  const submitDraft = (event: FormEvent) => {
    event.preventDefault()
    if (!draft) return
    const title = draft.title.trim()
    if (!title) { setError('任务标题不能为空。'); return }
    const dueAt = draftDueAt(draft)
    const remindAt = remindAtFromChoice(draft.remind, dueAt)
    setBusy(true); setError('')
    const request = draft.id
      ? window.electronAPI.tasks.update(draft.id, { title, note: draft.note, projectId: draft.projectId || null, priority: draft.priority, dueAt, remindAt, recurrence: draft.recurrence })
      : window.electronAPI.tasks.create({ title, note: draft.note, projectId: draft.projectId || null, priority: draft.priority, dueAt, remindAt, recurrence: draft.recurrence })
    void request
      .then(() => { setDraft(null); reload() })
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
                    <span className="tasks-project-actions"><button type="button" aria-label={`重命名 ${project.name}`} onClick={() => setRenaming({ id: project.id, name: project.name, original: project.name })}>…</button><button type="button" aria-label={`归档 ${project.name}`} onClick={() => void window.electronAPI.tasks.archiveProject(project.id, true).then(reload).catch(reason => setError(String(reason)))}>归档</button></span>
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
          <summary>已归档项目</summary>
          <ul role="list">{projects.filter(project => project.archivedAt).map(project => <li key={project.id}>{project.name} <button type="button" onClick={() => void window.electronAPI.tasks.archiveProject(project.id, false).then(reload).catch(reason => setError(String(reason)))}>恢复</button></li>)}</ul>
        </details>}
      </div>
    </aside>

    <section className="tasks-main" aria-label="任务列表">
      {quarantineNotice && <p role="alert" className="tasks-quarantine">{quarantineNotice}</p>}
      {error && <p role="alert" className="tasks-error">{error}</p>}
      <div className="tasks-toolbar">
        <label className="tasks-search"><span className="sr-only">搜索任务</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索任务或备注" />{query && <button type="button" aria-label="清空搜索" onClick={() => setQuery('')}>×</button>}</label>
        <p>{visible.length} 个进行中{totalDone > 0 ? ` · ${totalDone} 个已完成` : ''}</p>
        <button type="button" className="tasks-create" onClick={() => setDraft({ ...emptyDraft })}>新建任务</button>
      </div>

      {visible.length === 0 && !draft && <div className="tasks-empty">
        <h2>{query.trim() ? '没有匹配的任务' : selection.startsWith('project:') ? '这个项目还没有任务' : selection.startsWith('view:') ? '这个视图还没有匹配的任务' : '这里没有待办任务'}</h2>
        <p>{query.trim() ? '试试其他关键词，或清空搜索。' : '点击「新建任务」开始，支持截止日、提醒和优先级。'}</p>
      </div>}

      {draft && <div className="tasks-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setDraft(null) }}>
        <div className="tasks-dialog" role="dialog" aria-modal="true" aria-labelledby="tasks-dialog-title" onMouseDown={event => event.stopPropagation()}>
          <header className="tasks-dialog-header">
            <h2 id="tasks-dialog-title">{draft.id ? '编辑任务' : '新建任务'}</h2>
            <button type="button" aria-label="关闭任务弹窗" onClick={() => setDraft(null)}>×</button>
          </header>
          <form className="tasks-form" onSubmit={submitDraft} aria-label={draft.id ? '编辑任务' : '新建任务'}>
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
              {projects.filter(project => !project.archivedAt).map(project =>
                <option key={project.id} value={project.id}>{project.name}</option>)}
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

      <ul role="list" className="tasks-list">
        {visible.map(task => <li key={task.id} ref={element => { taskRefs.current[task.id] = element }} tabIndex={task.id === focusTaskId ? -1 : undefined} className={`tasks-item${task.id === focusTaskId ? ' tasks-item-focused' : ''}`} data-priority={task.priority}>
          <button type="button" className="tasks-complete" aria-label={`完成 ${task.title}`} onClick={() => complete(task.id)} />
          <div className="tasks-item-body">
            <div className="tasks-item-head">
              <span className="tasks-item-title">{task.title}</span>
              <details className="tasks-item-menu">
                <summary aria-label={`更多操作 ${task.title}`} title="更多操作">…</summary>
                <div className="tasks-item-menu-popover">
                  <button type="button" onClick={() => setDraft(draftFromTask(task))}>编辑任务</button>
                  <button type="button" className="tasks-item-menu-danger" onClick={() => remove(task.id)}>删除任务</button>
                </div>
              </details>
            </div>
            <span className="tasks-item-meta">
              {projects.find(project => project.id === task.projectId)?.name && <span className="tasks-chip tasks-chip-project">{projects.find(project => project.id === task.projectId)?.name}</span>}
              {task.dueAt !== null && <span className={isOverdue(task, Date.now()) ? 'tasks-overdue' : ''}>
                {isOverdue(task, Date.now()) ? '已过期 · ' : ''}{dueLabel(task.dueAt)}
              </span>}
              <span className={`tasks-chip tasks-chip-priority-${task.priority}`}>{PRIORITY_LABELS[task.priority]}优先级</span>
              {task.recurrence !== 'none' && <span className="tasks-chip">{RECURRENCE_LABELS[task.recurrence]}</span>}
              {task.remindAt !== null && <span className="tasks-chip">{task.remindFiredAt !== null ? '已提醒' : '已设置提醒'}</span>}
            </span>
            {task.note && <p className="tasks-item-note">{task.note}</p>}
            <span className="tasks-item-created">创建于 {dueLabel(task.createdAt)}</span>
          </div>
        </li>)}
      </ul>

      {doneTasks.length > 0 && <div className="tasks-done">
        <button type="button" aria-expanded={showDone} onClick={() => setShowDone(value => !value)}>
          已完成 {totalDone} 项 {showDone ? '收起' : '展开'}
        </button>
          {showDone && <ul role="list" className="tasks-list tasks-list-done">
          {doneTasks.map(task => <li key={task.id} className="tasks-item" data-priority={task.priority}>
            <span className="tasks-item-title tasks-item-done-title">{task.title}</span>
            <span className="tasks-item-meta">{task.completedAt ? dueLabel(task.completedAt) + ' 完成' : ''}</span>
            <button type="button" onClick={() => void window.electronAPI.tasks.reopen(task.id).then(reload).catch(reason => setError(String(reason)))}>恢复</button>
          </li>)}
        </ul>}
      </div>}
    </section>
  </div>
}
