import { useCallback, useEffect, useState, type FormEvent } from 'react'
import type { RemindChoiceId, TaskPriority, TaskProject, TaskRecord } from '../../../../shared/tasks'
import {
  PRIORITY_LABELS, REMIND_CHOICES, compareTasks, isDueThisWeek, isDueToday, isOverdue, remindAtFromChoice
} from '../../../../shared/tasks'
import './Tasks.css'

type SmartView = 'today' | 'week' | 'overdue' | 'all'
type Selection = SmartView | `project:${string}`

const SMART_VIEWS: { id: SmartView; label: string }[] = [
  { id: 'today', label: '今天' },
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
}

const emptyDraft: Draft = { id: '', title: '', note: '', projectId: '', priority: 'medium', dueDate: '', dueTime: '09:00', remind: 'due' }

const toInputDate = (at: number): string => {
  const date = new Date(at)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const draftDueAt = (draft: Draft): number | null => {
  if (!draft.dueDate) return null
  return new Date(`${draft.dueDate}T${draft.dueTime || '09:00'}`).getTime() || null
}
const draftFromTask = (task: TaskRecord): Draft => ({
  id: task.id,
  title: task.title,
  note: task.note,
  projectId: task.projectId ?? '',
  priority: task.priority,
  dueDate: task.dueAt ? toInputDate(task.dueAt) : '',
  dueTime: task.dueAt ? new Date(task.dueAt).toTimeString().slice(0, 5) : '09:00',
  remind: 'none'
})
const dueLabel = (at: number): string =>
  new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(at)

export default function TasksView({ active }: { active: boolean }) {
  const [selection, setSelection] = useState<Selection>('today')
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [doneTasks, setDoneTasks] = useState<TaskRecord[]>([])
  const [projects, setProjects] = useState<TaskProject[]>([])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [quarantineNotice, setQuarantineNotice] = useState('')

  const reload = useCallback(() => {
    void Promise.all([window.electronAPI.tasks.list(), window.electronAPI.tasks.projects()])
      .then(([list, projectList]) => {
        setTasks(list.open)
        setDoneTasks(list.done)
        setProjects(projectList)
        setQuarantineNotice(list.quarantinedAt ? '任务数据文件曾无法读取，已重建空库，原文件已隔离保存。' : '')
      })
      .catch(reason => setError(String(reason)))
  }, [])

  useEffect(() => { if (active) reload() }, [active, reload])

  const visible = tasks.filter(task => {
    if (selection.startsWith('project:')) return task.projectId === selection.slice('project:'.length)
    if (selection === 'today') return isDueToday(task, Date.now()) || isOverdue(task, Date.now())
    if (selection === 'week') return isDueThisWeek(task, Date.now())
    if (selection === 'overdue') return isOverdue(task, Date.now())
    return true
  }).sort((a, b) => compareTasks(a, b, Date.now()))

  const submitDraft = (event: FormEvent) => {
    event.preventDefault()
    if (!draft) return
    const title = draft.title.trim()
    if (!title) { setError('任务标题不能为空。'); return }
    const dueAt = draftDueAt(draft)
    const remindAt = remindAtFromChoice(draft.remind, dueAt)
    setBusy(true); setError('')
    const request = draft.id
      ? window.electronAPI.tasks.update(draft.id, { title, note: draft.note, projectId: draft.projectId || null, priority: draft.priority, dueAt, remindAt })
      : window.electronAPI.tasks.create({ title, note: draft.note, projectId: draft.projectId || null, priority: draft.priority, dueAt, remindAt })
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
  const createProjectInline = () => {
    const name = window.prompt('项目名称')?.trim()
    if (!name) return
    void window.electronAPI.tasks.createProject(name).then(reload).catch(reason => setError(String(reason)))
  }

  return <div className="tasks-view">
    <aside className="tasks-sidebar" aria-label="任务视图筛选">
      <ul role="list">
        {SMART_VIEWS.map(view => <li key={view.id}>
          <button type="button" aria-current={selection === view.id || undefined} onClick={() => setSelection(view.id)}>{view.label}</button>
        </li>)}
      </ul>
      <div className="tasks-sidebar-projects">
        <h2>项目</h2>
        <ul role="list">
          {projects.filter(project => !project.archivedAt).map(project => {
            const id = `project:${project.id}` as Selection
            return <li key={project.id}>
              <button type="button" aria-current={selection === id || undefined} onClick={() => setSelection(id)}>{project.name}</button>
            </li>
          })}
          <li><button type="button" className="tasks-new-project" onClick={createProjectInline}>新建项目 +</button></li>
        </ul>
        {projects.some(project => project.archivedAt) && <details className="tasks-archived">
          <summary>已归档项目</summary>
          <ul role="list">{projects.filter(project => project.archivedAt).map(project => <li key={project.id}>{project.name}</li>)}</ul>
        </details>}
      </div>
    </aside>

    <section className="tasks-main" aria-label="任务列表">
      {quarantineNotice && <p role="alert" className="tasks-quarantine">{quarantineNotice}</p>}
      {error && <p role="alert" className="tasks-error">{error}</p>}
      <div className="tasks-toolbar">
        <p>{visible.length} 个进行中{doneTasks.length > 0 ? ` · ${doneTasks.length} 个已完成` : ''}</p>
        <button type="button" className="tasks-create" onClick={() => setDraft({ ...emptyDraft })}>新建任务</button>
      </div>

      {visible.length === 0 && !draft && <div className="tasks-empty">
        <h2>{selection.startsWith('project:') ? '这个项目还没有任务' : '这里没有待办任务'}</h2>
        <p>点击「新建任务」开始,支持截止日、提醒和优先级。</p>
      </div>}

      {draft && <form className="tasks-form" onSubmit={submitDraft} aria-label={draft.id ? '编辑任务' : '新建任务'}>
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
        </div>
        <div className="tasks-form-row">
          <label>
            截止日期
            <input type="date" value={draft.dueDate} onChange={e => setDraft({ ...draft, dueDate: e.target.value })} aria-label="任务截止日期" />
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
      </form>}

      <ul role="list" className="tasks-list">
        {visible.map(task => <li key={task.id} className="tasks-item" data-priority={task.priority}>
          <button type="button" className="tasks-complete" aria-label={`完成 ${task.title}`} onClick={() => complete(task.id)} />
          <div className="tasks-item-body">
            <span className="tasks-item-title">{task.title}</span>
            <span className="tasks-item-meta">
              {projects.find(project => project.id === task.projectId)?.name}
              {task.dueAt !== null && <span className={isOverdue(task, Date.now()) ? 'tasks-overdue' : ''}>
                {isOverdue(task, Date.now()) ? '已过期 · ' : ''}{dueLabel(task.dueAt)}
              </span>}
              <span>{PRIORITY_LABELS[task.priority]}优先</span>
            </span>
            {task.note && <span className="tasks-item-note">{task.note}</span>}
          </div>
          <div className="tasks-item-actions">
            <button type="button" onClick={() => setDraft(draftFromTask(task))} aria-label={`编辑 ${task.title}`}>编辑</button>
            <button type="button" onClick={() => remove(task.id)} aria-label={`删除 ${task.title}`}>删除</button>
          </div>
        </li>)}
      </ul>

      {doneTasks.length > 0 && <div className="tasks-done">
        <button type="button" aria-expanded={showDone} onClick={() => setShowDone(value => !value)}>
          已完成 {doneTasks.length} 项 {showDone ? '收起' : '展开'}
        </button>
        {showDone && <ul role="list" className="tasks-list tasks-list-done">
          {doneTasks.map(task => <li key={task.id} className="tasks-item" data-priority={task.priority}>
            <span className="tasks-item-title tasks-item-done-title">{task.title}</span>
            <span className="tasks-item-meta">{task.completedAt ? dueLabel(task.completedAt) + ' 完成' : ''}</span>
          </li>)}
        </ul>}
      </div>}
    </section>
  </div>
}
