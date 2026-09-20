import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { RemindChoiceId, TaskDueRange, TaskGroup, TaskPriority, TaskProject, TaskRecord, TaskSelectField, TaskSelectFieldUpdateInput, TaskSortMode, TaskView, TaskUpdateInput } from '../../../../shared/tasks'
import {
  DUE_RANGE_LABELS, PRIORITY_LABELS, REMIND_CHOICES, TASK_SORT_LABELS, compareTasks, isUnplanned, isDueThisWeek, isDueToday, isOverdue, matchesTaskView, remindAtFromChoice, sortTasks
} from '../../../../shared/tasks'
import TasksBoard, { groupTasks, type BoardGroupMode } from './TasksBoard'
import TaskEditorDialog, { type TaskDraft as Draft } from './TaskEditorDialog'
import TaskFieldsDialog from './TaskFieldsDialog'
import TaskCollectionDialog from './TaskCollectionDialog'
import TaskDisplayGroupForm from './TaskDisplayGroupForm'
import TaskCardMeta, { TaskCardDue } from './TaskCardMeta'
import TaskIcon, { type IconName } from './TaskIcon'
import useTaskMenus from './useTaskMenus'
import useTaskViewPreferences from './useTaskViewPreferences'
import { applyTaskOrder, assignTaskToGroup, moveTaskInOrder } from './taskViewPreferences'
import { useConfirm } from '../common/ConfirmProvider'
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
const SMART_DESCRIPTIONS: Record<SmartView, string> = {
  today: '截止日期在今天的任务，不包含更早的过期任务。',
  week: '本周一至周日截止的任务，包含今天和本周内已过期的任务。',
  unplanned: '开始和截止时间都未设置的任务；安排任一时间后会移出这里。',
  all: '汇总所有清单的任务，默认显示未完成任务。',
  overdue: '截止日期早于今天的任务。',
  done: '已完成任务保留原有清单与时间安排，可以随时恢复。'
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
  const confirm = useConfirm()
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
  const [selection, setSelection] = useState<Selection>(() => {
    try {
      const last = localStorage.getItem('chouyu:task-selection') ?? ''
      return SMART_VIEWS.some(view => view.id === last) || /^(project|view):.+$/.test(last) ? last as Selection : 'today'
    } catch { return 'today' }
  })
  useEffect(() => { try { localStorage.setItem('chouyu:task-selection', selection) } catch { /* Preferences report storage errors separately. */ } }, [selection])
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
  const preferences = useTaskViewPreferences(selection)
  const { mode, listGrouped, groupMode, groupFieldId, sortMode, hiddenFields, taskOrder, customGroups } = preferences.value
  const [displayGroupDraft, setDisplayGroupDraft] = useState<{ id: string; name: string } | null>(null)
  const [listDropGroup, setListDropGroup] = useState<string | null>(null)
  useEffect(() => { setDisplayGroupDraft(null) }, [selection])
  const setMode = (value: 'list' | 'board') => preferences.set('mode', value)
  const setGroupFieldId = (value: string | null) => preferences.set('groupFieldId', value)
  const setSortMode = (value: TaskSortMode) => preferences.set('sortMode', value)
  const setHiddenFields = (value: string[] | ((current: string[]) => string[])) => preferences.set('hiddenFields', value)
  const [viewDraft, setViewDraft] = useState<ViewDraft | null>(null)
  const [draft, updateDraft] = useState<Draft | null>(null)
  const taskOpenerRef = useRef<HTMLElement | null>(null)
  const restoreTaskFocusRef = useRef(false)
  const setDraft: typeof updateDraft = value => {
    if (!draft && value !== null) {
      const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
      taskOpenerRef.current = opener
      // Capture keyboard focus before the editor autofocuses its title input.
      restoreTaskFocusRef.current = opener?.matches(':focus-visible') ?? false
    }
    updateDraft(value && typeof value !== 'function' && value.displayGroupId === undefined
      ? { ...value, displayGroupId: customGroups.find(group => group.taskIds.includes(value.id))?.id ?? '' } : value)
  }
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [filterPriorities, setFilterPriorities] = useState<TaskPriority[]>([])
  const [filterProjects, setFilterProjects] = useState<string[]>([])
  const [filterDue, setFilterDue] = useState<TaskDueRange>('any')
  const [statusFilter, setStatusFilter] = useState<'open' | 'done' | 'all'>('open')
  const effectiveStatus = selection === 'done' ? 'done' : statusFilter
  const filterCount = Number(filterPriorities.length > 0) + Number(filterProjects.length > 0) + Number(filterDue !== 'any')
  const clearFilters = () => { setFilterPriorities([]); setFilterProjects([]); setFilterDue('any') }
  const displayFields = fields.filter(field => !hiddenFields.includes(field.id))
  const [quarantineNotice, setQuarantineNotice] = useState('')
  const [groups, setGroups] = useState<TaskGroup[]>([])
  const groupRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const [revealGroupId, setRevealGroupId] = useState<string | null>(null)
  const [groupRenaming, setGroupRenaming] = useState<TaskGroup | null>(null)
  const [newGroup, setNewGroup] = useState<string | null>(null)
  const [projectGroupId, setProjectGroupId] = useState('')
  const [projectBusy, setProjectBusy] = useState(false)
  const [newProject, setNewProject] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string; original: string } | null>(null)
  const [fieldsOpen, setFieldsOpen] = useState(false)
  const taskRefs = useRef<Record<string, HTMLLIElement | null>>({})
  useEffect(() => {
    if (!revealGroupId || sidebarCollapsed) return
    const element = groupRefs.current[revealGroupId]
    if (!element) return
    element.scrollIntoView({ block: 'nearest' })
    setRevealGroupId(null)
  }, [revealGroupId, sidebarCollapsed, groups])

  const reload = useCallback(() => {
    const sequence = ++reloadSequence.current
    setLoading(true)
    void Promise.all([window.electronAPI.tasks.list({ doneLimit, doneQuery: query, donePriorities: filterPriorities,
      doneProjectIds: filterProjects, doneDueRange: filterDue,
      doneSelection: selection }), window.electronAPI.tasks.projects(), window.electronAPI.tasks.views(), window.electronAPI.tasks.fields(), window.electronAPI.tasks.groups()])
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
        if ((selection.startsWith('project:') && !projectList.some(project => project.id === selection.slice(8))) ||
          (selection.startsWith('view:') && !viewList.some(view => view.id === selection.slice(5)))) setSelection('today')
        window.dispatchEvent(new Event('chouyu:tasks-changed'))
        setQuarantineNotice(list.quarantinedAt ? '任务数据文件曾无法读取，已重建空库，原文件已隔离保存。' : '')
      })
      .catch(reason => { if (sequence === reloadSequence.current) setError(String(reason)) })
      .finally(() => { if (sequence === reloadSequence.current) setLoading(false) })
  }, [doneLimit, query, filterPriorities, filterProjects, filterDue, selection])
  const reloadRef = useRef(reload)
  reloadRef.current = reload

  useEffect(() => {
    if (!active) return
    const timer = setTimeout(reload, 100)
    return () => { clearTimeout(timer); reloadSequence.current += 1 }
  }, [active, reload])
  useEffect(() => { setDoneLimit(50) }, [query, filterPriorities, filterProjects, filterDue, selection])
  useEffect(() => {
    if (!draft && !viewDraft && !fieldsOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      event.stopPropagation()
      if (!busy && !projectBusy) {
        if (fieldsOpen) setFieldsOpen(false)
        else if (viewDraft) setViewDraft(null)
        else setDraft(null)
      }
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [draft, viewDraft, fieldsOpen, busy, projectBusy])
  useEffect(() => { setStatusFilter('open') }, [selection])
  useEffect(() => { if (focusTaskId) { setSelection('all'); setQuery(''); clearFilters(); setStatusFilter('open'); preferences.update('all', { mode: 'list' }) } }, [focusTaskId])
  useEffect(() => {
    if (!searchRequest) return
    setSelection(searchRequest.done ? 'done' : 'all'); setQuery(searchRequest.done ? searchRequest.query : ''); clearFilters(); setStatusFilter('open'); preferences.update(searchRequest.done ? 'done' : 'all', { mode: 'list' })
  }, [searchRequest])
  useEffect(() => {
    if (!active || !focusTaskId) return
    const element = taskRefs.current[focusTaskId]
    if (!element) return
    element.scrollIntoView({ block: 'center' })
    element.focus({ preventScroll: true })
  }, [active, focusTaskId, tasks, doneTasks, selection, searchRequest])

  const taskDialogRef = useRef<HTMLDivElement>(null)
  const draftOpen = draft !== null
  useEffect(() => {
    if (!draftOpen) return
    const previous = taskOpenerRef.current
    const restoreFocus = restoreTaskFocusRef.current
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const controls = Array.from(taskDialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea, summary') ?? []).filter(element => element.getClientRects().length > 0)
      const first = controls[0], last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', trap)
    return () => {
      document.removeEventListener('keydown', trap)
      if (restoreFocus) (previous?.isConnected ? previous : menusRef.current?.querySelector<HTMLElement>('.tasks-create'))?.focus()
    }
  }, [draftOpen])

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
    matchesTaskView({ ...task, status: 'open' }, { priorities: filterPriorities, projectIds: filterProjects, dueRange: filterDue }, now)
  const visible = (effectiveStatus === 'done' ? [] : tasks).filter(task => matchesKeywordAndFilter(task) && matchesSelection(task, selection))
    .sort((a, b) => compareTasks(a, b, now))
  // Recheck the current scope while its paginated history request is still in flight.
  const doneVisible = effectiveStatus !== 'open' ? doneTasks.filter(task => matchesKeywordAndFilter(task) &&
    (selection === 'done' || matchesSelection({ ...task, status: 'open' }, selection))) : []
  const sortedByMode = sortTasks([...visible, ...(selection === 'done' ? [] : doneVisible)], sortMode, now)
  const sorted = sortMode === 'manual' ? applyTaskOrder(sortedByMode, taskOrder) : sortedByMode
  const countFor = (target: Selection) => target === 'done' ? totalDone : tasks.filter(task => matchesSelection(task, target)).length
  const boardGroupMode: BoardGroupMode = groupMode === 'field' && !fields.some(field => field.id === groupFieldId) ? 'priority' : groupMode

  const submitDraft = (event: FormEvent) => {
    event.preventDefault()
    if (!draft || busy || projectBusy) return
    const title = draft.title.trim()
    if (!title) { setError('任务标题不能为空。'); return }
    if (!draft.projectId) { setError('请先选择或创建所属清单。'); return }
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
        if (draft.displayGroupId !== undefined) preferences.update(selection, current => ({ ...current, customGroups: assignTaskToGroup(current.customGroups, saved.id, draft.displayGroupId!) }))
        setDraft(null)
        const hidden = !matchesKeywordAndFilter(saved) || (saved.status === 'open'
          ? effectiveStatus === 'done' || selection === 'done' || !matchesSelection(saved, selection)
          : effectiveStatus === 'open' || (selection !== 'done' && !matchesSelection({ ...saved, status: 'open' }, selection)))
        setNotice(`${draft.id ? '任务已保存。' : '任务已创建。'}${hidden ? '该任务不符合当前视图或筛选条件，暂不在此显示。' : ''}`)
        reloadRef.current()
      })
      .catch(reason => setError(String(reason)))
      .finally(() => setBusy(false))
  }

  const actionLock = useRef(false)
  const [actionPending, setActionPending] = useState(false)
  const performAction = async (operation: () => Promise<unknown>, message: string) => {
    if (actionLock.current) return
    actionLock.current = true; setActionPending(true); setError(''); setNotice('正在保存修改…')
    try { await operation(); setNotice(message); reloadRef.current() }
    catch (reason) { setNotice(''); setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { actionLock.current = false; setActionPending(false) }
  }
  const complete = (id: string) => { void performAction(() => window.electronAPI.tasks.complete(id), '任务已完成。') }
  const reopen = (id: string) => { void performAction(() => window.electronAPI.tasks.reopen(id), '任务已恢复。') }
  const remove = async (id: string) => {
    if (!await confirm({ title: '删除任务', message: '删除这个任务？此操作无法撤销。' })) return
    void performAction(() => window.electronAPI.tasks.remove(id), '任务已删除。')
  }
  const archiveProject = (project: TaskProject) => {
    void performAction(async () => {
      await window.electronAPI.tasks.archiveProject(project.id, true)
      setSelection(current => current === `project:${project.id}` ? 'all' : current)
    }, `「${project.name}」已归档，未完成任务和提醒仍会保留。`)
  }
  const submitProject = (event: FormEvent) => {
    event.preventDefault()
    const name = newProject?.trim()
    if (!name || projectBusy) return
    setProjectBusy(true); setError('')
    void window.electronAPI.tasks.createProject(name, projectGroupId || null)
      .then(() => { setNewProject(null); reloadRef.current() })
      .catch(reason => setError(String(reason))).finally(() => setProjectBusy(false))
  }
  const submitGroup = (event: FormEvent) => {
    event.preventDefault()
    if (!newGroup?.trim() || projectBusy) return
    setProjectBusy(true); setError('')
    void window.electronAPI.tasks.createGroup(newGroup.trim())
      .then(group => {
        setGroups(current => [...current.filter(item => item.id !== group.id), group])
        setSidebarCollapsed(false); setRevealGroupId(group.id)
        setNewGroup(null); setNotice(`已创建分组「${group.name}」，可以在分组中添加清单。`)
        reloadRef.current()
      })
      .catch(reason => setError(String(reason))).finally(() => setProjectBusy(false))
  }

  const submitGroupRename = (event: FormEvent) => {
    event.preventDefault()
    if (!groupRenaming?.name.trim() || projectBusy) return
    setProjectBusy(true); setError('')
    void window.electronAPI.tasks.renameGroup(groupRenaming.id, groupRenaming.name.trim())
      .then(() => { setGroupRenaming(null); reloadRef.current() })
      .catch(reason => setError(String(reason))).finally(() => setProjectBusy(false))
  }
  const removeGroup = async (group: TaskGroup) => {
    if (!await confirm({ title: '删除分组', message: `删除分组「${group.name}」？其中的清单和任务会保留，清单将移到默认分组。` })) return
    void performAction(() => window.electronAPI.tasks.deleteGroup(group.id), '分组已删除，清单和任务已保留。')
  }
  const startGroupProject = (group: TaskGroup) => {
    setProjectGroupId(group.id); setNewProject(''); setNewGroup(null); setGroupRenaming(null); setError('')
  }
  const createDraftProject = async (name: string, groupId: string): Promise<TaskProject | null> => {
    if (projectBusy) return null
    setProjectBusy(true); setError('')
    try {
      const project = await window.electronAPI.tasks.createProject(name, groupId)
      setProjects(current => [...current.filter(item => item.id !== project.id), project])
      return project
    } catch (reason) { setError(String(reason)); return null }
    finally { setProjectBusy(false) }
  }

  const submitRename = (event: FormEvent) => {
    event.preventDefault()
    const target = renaming
    setRenaming(null)
    const name = target?.name.trim()
    if (!target || !name || name === target.original) return
    void window.electronAPI.tasks.renameProject(target.id, name).then(() => reloadRef.current()).catch(reason => setError(String(reason)))
  }
  const submitViewDraft = (event: FormEvent) => {
    event.preventDefault()
    if (!viewDraft || busy) return
    const name = viewDraft.name.trim()
    if (!name) { setError('视图名称不能为空。'); return }
    const input = { name, projectIds: viewDraft.projectIds, priorities: viewDraft.priorities, dueRange: viewDraft.dueRange }
    setBusy(true); setError('')
    const request = viewDraft.id
      ? window.electronAPI.tasks.updateView(viewDraft.id, input)
      : window.electronAPI.tasks.createView(input)
    void request
      .then(() => { setViewDraft(null); reloadRef.current() })
      .catch(reason => setError(String(reason)))
      .finally(() => setBusy(false))
  }
  const removeView = async (view: TaskView) => {
    if (!await confirm({ title: '删除视图', message: `删除视图「${view.name}」？任务本身不受影响。` })) return
    void performAction(async () => { await window.electronAPI.tasks.deleteView(view.id); setSelection(current => current === `view:${view.id}` ? 'today' : current) }, '视图已删除，任务已保留。')
  }
  const saveField = async (id: string | null, input: TaskSelectFieldUpdateInput): Promise<TaskSelectField> => {
    setBusy(true); setError('')
    try {
      const saved = id
        ? await window.electronAPI.tasks.updateField(id, input)
        : await window.electronAPI.tasks.createField({ name: input.name ?? '', options: input.options?.map(option => typeof option === 'string' ? option : option.name) })
      reloadRef.current()
      setNotice('字段已保存。')
      return saved
    } catch (reason) {
      setError(String(reason))
      throw reason
    } finally { setBusy(false) }
  }
  const createDraft = (patch: TaskUpdateInput = {}): Draft => {
    const view = selection.startsWith('view:') ? views.find(item => item.id === selection.slice(5)) : undefined
    const candidate = selection.startsWith('project:') ? selection.slice(8) : view?.projectIds.length === 1 ? view.projectIds[0] : ''
    const projectId = projects.some(project => project.id === candidate && !project.archivedAt) ? candidate : projects.find(project => project.isDefault)?.id ?? ''
    const dueDate = selection === 'today' || selection === 'week' || view?.dueRange === 'today' || view?.dueRange === 'week' ? toInputDate(Date.now()) : ''
    const priority = filterPriorities.length === 1 ? filterPriorities[0] : view?.priorities.length === 1 ? view.priorities[0] : emptyDraft.priority
    return { ...emptyDraft, projectId, dueDate, priority, title: patch.title ?? '', ...(patch.projectId ? { projectId: patch.projectId } : {}), ...(patch.priority ? { priority: patch.priority } : {}), customFields: Object.fromEntries(Object.entries(patch.customFields ?? {}).filter((entry): entry is [string, string] => entry[1] !== null)) }
  }
  const startCreate = () => { setError(''); setDraft(createDraft()) }
  const removeField = async (field: TaskSelectField) => {
    if (busy) return
    setBusy(true); setError('')
    try {
      await window.electronAPI.tasks.deleteField(field.id)
      if (groupFieldId === field.id) setGroupFieldId(null)
      setNotice('字段已删除。'); reloadRef.current()
    } catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }

  const startNewGroup = () => { setNewGroup(''); setNewProject(null); setGroupRenaming(null); setError('') }
  const startDisplayGroup = () => { setDisplayGroupDraft({ id: '', name: '' }); setError('') }
  const saveDisplayGroup = (name: string): string | void => {
    if (!displayGroupDraft) return
    if (customGroups.some(group => group.id !== displayGroupDraft.id && group.name === name)) return '当前视图已有同名分组。'
    const id = displayGroupDraft.id || crypto.randomUUID()
    preferences.update(selection, current => ({ ...current, listGrouped: true, groupMode: 'custom', groupFieldId: null,
      customGroups: displayGroupDraft.id ? current.customGroups.map(group => group.id === id ? { ...group, name } : group) : [...current.customGroups, { id, name, taskIds: [] }]
    }))
    setDisplayGroupDraft(null); setNotice(displayGroupDraft.id ? '分组已重命名。' : `已创建任务分组「${name}」。`)
  }
  const deleteDisplayGroup = async (id: string) => {
    const group = customGroups.find(item => item.id === id)
    if (!group) return
    const scope = selection
    if (!await confirm({ title: '删除任务分组', message: `删除「${group.name}」？组内任务会保留并移到当前视图的“未分组”。`, confirmLabel: '删除分组' })) return
    preferences.update(scope, current => ({ ...current, customGroups: current.customGroups.filter(item => item.id !== id) }))
    setNotice('分组已删除，组内任务已保留。')
  }
  const renderDisplayGroupActions = (id: string) => {
    const group = customGroups.find(item => item.id === id)
    if (boardGroupMode !== 'custom' || !group) return null
    return <details className="tasks-item-menu tasks-display-group-menu">
      <summary aria-label={`管理任务分组 ${group.name}`} title="管理任务分组"><TaskIcon name="more" /></summary>
      <div className="tasks-item-menu-popover">
        <button type="button" onClick={() => setDisplayGroupDraft({ id, name: group.name })}>重命名分组</button>
        <button type="button" className="tasks-item-menu-danger" onClick={() => void deleteDisplayGroup(id)}>删除分组</button>
      </div>
    </details>
  }
  const applyGrouping = (value: string) => {
    setDisplayGroupDraft(null); setListDropGroup(null)
    preferences.update(selection, value === 'none' ? { listGrouped: false } : {
      listGrouped: true,
      groupMode: value.startsWith('field:') ? 'field' : value as BoardGroupMode,
      groupFieldId: value.startsWith('field:') ? value.slice('field:'.length) : null
    })
  }
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
                {!project.isDefault && <><label>移至分组<select aria-label={`移动清单 ${project.name} 到分组`} value={project.groupId ?? ''} onChange={e => void window.electronAPI.tasks.moveProject(project.id, e.target.value || null).then(() => reloadRef.current()).catch(reason => setError(String(reason)))}>
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

  const renderTask = (task: TaskRecord) => {
    return <li key={task.id} data-task-id={task.id} ref={element => { taskRefs.current[task.id] = element }} tabIndex={0} aria-label={`任务：${task.title}，按 Enter 编辑`} className={`tasks-item${task.id === focusTaskId ? ' tasks-item-focused' : ''}`} data-priority={task.priority} data-completed={task.status === 'done' || undefined}
          draggable={listGrouped && boardGroupMode === 'custom'}
          onDragStart={event => { event.dataTransfer.setData('application/x-chouyu-list-task', task.id); event.dataTransfer.effectAllowed = 'move' }}
          onDragEnd={() => setListDropGroup(null)}
          onClick={event => {
            if ((event.target as Element).closest('button, .tasks-item-menu, a, input, select, textarea, [role="button"]') || window.getSelection()?.toString()) return
            event.currentTarget.focus({ preventScroll: true })
            setDraft(draftFromTask(task))
          }}
          onKeyDown={event => {
            if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return
            event.preventDefault(); setDraft(draftFromTask(task))
          }}>
          <button type="button" className="tasks-complete" disabled={actionPending} data-done={task.status === 'done' || undefined} aria-label={`${task.status === 'done' ? '恢复' : '完成'} ${task.title}`} onClick={() => task.status === 'done' ? reopen(task.id) : complete(task.id)}>{task.status === 'done' ? '✓' : ''}</button>
          <div className="tasks-item-body">
            <div className="tasks-item-head">
              <button type="button" className="tasks-item-title tasks-title-button" onClick={() => setDraft(draftFromTask(task))}>{task.title}</button>
            </div>
            {!hiddenFields.includes('note') && task.note && <p className="tasks-item-note" title={task.note}>{task.note}</p>}
            <TaskCardMeta task={task} projects={projects} fields={displayFields} showAllFields />
            <div className="tasks-card-schedule">
              {!hiddenFields.includes('start') && task.startAt != null && <span className="tasks-start-cell"><TaskIcon name="today" /><span>开始 <time dateTime={new Date(task.startAt).toISOString()}>{dueLabel(task.startAt)}</time></span></span>}
              {!hiddenFields.includes('due') && task.dueAt !== null && <span className="tasks-due-cell"><span>截止</span><TaskCardDue task={task} /></span>}
              {task.startAt == null && task.dueAt === null && task.status === 'open' && (!hiddenFields.includes('start') || !hiddenFields.includes('due')) && <span className="tasks-card-unplanned"><TaskIcon name="unplanned" />待规划 · 未安排时间</span>}
              {task.status === 'done' && <span className="tasks-card-completed">已完成{task.completedAt ? ` · ${dueLabel(task.completedAt)}` : ''}</span>}
            </div>
          </div>
              <details className="tasks-item-menu">
                <summary aria-label={`更多操作 ${task.title}`} title="更多操作"><TaskIcon name="more" /></summary>
                <div className="tasks-item-menu-popover">
                  <button type="button" onClick={() => setDraft(draftFromTask(task))}>编辑任务</button>
                  <button type="button" className="tasks-item-menu-danger" onClick={() => remove(task.id)}>删除任务</button>
                </div>
              </details>
        </li>
  }

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
        {groups.map(group => <div className="tasks-group-shell" key={group.id} data-group-id={group.id} ref={element => { groupRefs.current[group.id] = element }}>
          <details className="tasks-project-group" open>
            <summary aria-label={`折叠或展开分组 ${group.name}`}><span className="tasks-group-chevron"><TaskIcon name="chevron" /></span><span>{group.name}</span></summary>
            <ul role="list">{projects.filter(project => !project.archivedAt && project.groupId === group.id).sort((a, b) => Number(Boolean(b.isDefault)) - Number(Boolean(a.isDefault))).map(renderProject)}</ul>
            {!projects.some(project => !project.archivedAt && project.groupId === group.id) && <button type="button" className="tasks-empty-group-add" onClick={() => startGroupProject(group)}><TaskIcon name="plus" />添加第一个清单</button>}
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
                <button type="button" onClick={startNewGroup}><TaskIcon name="folder" />新建清单分组</button>
                <button type="button" onClick={() => startGroupProject(group)}><TaskIcon name="task" />新建清单</button>
              </div>
            </details> : <button type="button" className="tasks-group-add" aria-label={`在 ${group.name} 中新建清单`} title="新建清单" onClick={() => startGroupProject(group)}><TaskIcon name="plus" /></button>}
          </div>
        </div>)}
        {projects.some(project => project.archivedAt) && <details className="tasks-archived">
          <summary title="归档只收起清单入口，未完成任务和提醒仍会保留">已归档清单</summary>
          <ul role="list">{projects.filter(project => project.archivedAt).map(project => <li key={project.id}>{project.name} <button type="button" onClick={() => void window.electronAPI.tasks.archiveProject(project.id, false).then(() => reloadRef.current()).catch(reason => setError(String(reason)))}>恢复</button></li>)}</ul>
        </details>}
      </div>
    </aside>

    <section className="tasks-main" aria-label="任务列表" data-hide-priority={hiddenFields.includes('priority') || undefined} data-hide-project={hiddenFields.includes('project') || undefined} data-hide-start={hiddenFields.includes('start') || undefined} data-hide-due={hiddenFields.includes('due') || undefined}>
      {preferences.storageError && <p role="status" className="tasks-notice">{preferences.storageError}</p>}
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
      {selection in SMART_DESCRIPTIONS && <p className="tasks-view-description">{SMART_DESCRIPTIONS[selection as SmartView]}</p>}
      {selection !== 'done' && <div className="tasks-tabs" role="group" aria-label="展示方式">
        <button type="button" className="tasks-tab" aria-pressed={mode === 'list'} onClick={() => setMode('list')}><TaskIcon name="list" />列表</button>
        <button type="button" className="tasks-tab" aria-pressed={mode === 'board'} onClick={() => setMode('board')}><TaskIcon name="board" />看板</button>
      </div>}
      <div className="tasks-toolbar">
        <div className="tasks-toolbar-group">
          <div className="tasks-create-split">
            <button type="button" className="tasks-create" onClick={startCreate}><TaskIcon name="plus" />新建任务</button>
            {((mode === 'list' && !listGrouped) || boardGroupMode === 'custom') && <details className="tasks-tool-menu tasks-create-options">
              <summary aria-label="新建任务选项" title="新建任务选项"><TaskIcon name="chevron" /></summary>
              <div className="tasks-item-menu-popover">
                <button type="button" onClick={startCreate}><TaskIcon name="task" />新建任务</button>
                <button type="button" onClick={startDisplayGroup}><TaskIcon name="group" />新建分组</button>
              </div>
            </details>}
          </div>
          {selection !== 'done' && <details className="tasks-tool-menu">
            <summary aria-label="任务完成状态" title={`状态：${effectiveStatus === 'open' ? '未完成' : effectiveStatus === 'done' ? '已完成' : '全部任务'}`} data-active={effectiveStatus !== 'open' || undefined}><TaskIcon name="done" /><span>{effectiveStatus === 'open' ? '未完成' : effectiveStatus === 'done' ? '已完成' : '全部任务'}</span></summary>
            <div className="tasks-item-menu-popover tasks-tool-popover">{(['open', 'done', 'all'] as const).map(status => <button type="button" key={status} aria-current={effectiveStatus === status || undefined} onClick={() => setStatusFilter(status)}>{status === 'open' ? '未完成' : status === 'done' ? '已完成' : '全部任务'}</button>)}</div>
          </details>}
          <details className="tasks-tool-menu">
            <summary aria-label="筛选任务" title="筛选任务" data-active={filterCount > 0 || undefined}><TaskIcon name="filter" /><span>筛选</span>{filterCount > 0 && <span className="tasks-tool-badge">{filterCount}</span>}</summary>
            <div className="tasks-item-menu-popover tasks-tool-popover" role="group" aria-label="筛选优先级">
              <p className="tasks-tool-title">筛选 · 同时满足以下条件</p><p className="tasks-tool-title">优先级（可多选）</p>
              {(['high', 'medium', 'low'] as TaskPriority[]).map(priority => (
                <label key={priority} className="tasks-view-check">
                  <input type="checkbox" checked={filterPriorities.includes(priority)}
                    onChange={e => setFilterPriorities(e.target.checked ? [...filterPriorities, priority] : filterPriorities.filter(item => item !== priority))} />
                  {PRIORITY_LABELS[priority]}
                </label>
              ))}
              <label className="tasks-filter-row">清单<select aria-label="筛选清单" value={filterProjects[0] ?? ''} onChange={e => setFilterProjects(e.target.value ? [e.target.value] : [])}><option value="">全部清单</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}{project.archivedAt ? '（已归档）' : ''}</option>)}</select></label>
              <label className="tasks-filter-row">截止范围<select aria-label="筛选截止范围" value={filterDue} onChange={e => setFilterDue(e.target.value as TaskDueRange)}>{(Object.keys(DUE_RANGE_LABELS) as TaskDueRange[]).map(id => <option key={id} value={id}>{DUE_RANGE_LABELS[id]}</option>)}</select></label>
              {filterCount > 0 && <button type="button" onClick={clearFilters}>清除筛选</button>}
              {filterCount > 0 && <button type="button" onClick={() => setViewDraft({ ...emptyViewDraft, projectIds: filterProjects, priorities: filterPriorities, dueRange: filterDue })}>保存为新视图</button>}
            </div>
          </details>
          {selection !== 'done' && <details className="tasks-tool-menu">
            <summary aria-label="排序方式" title={`排序：${TASK_SORT_LABELS[sortMode]}`} data-active={sortMode !== 'smart' || undefined}><TaskIcon name="sort" /><span>排序：{TASK_SORT_LABELS[sortMode]}</span></summary>
            <div className="tasks-item-menu-popover tasks-tool-popover" role="group" aria-label="排序方式">
              {(Object.keys(TASK_SORT_LABELS) as TaskSortMode[]).map(id => (
                <button key={id} type="button" aria-current={sortMode === id || undefined}
                  onClick={e => { setSortMode(id); e.currentTarget.closest('details')?.removeAttribute('open') }}>
                  {TASK_SORT_LABELS[id]}
                </button>
              ))}
            </div>
          </details>}
          <details className="tasks-tool-menu tasks-grouping-menu"><summary aria-label="任务分组" title="任务展示分组"><TaskIcon name="group" /><span>分组：{(mode === 'list' || selection === 'done') && !listGrouped ? '不分组' : boardGroupMode === 'custom' ? '自定义分组' : boardGroupMode === 'priority' ? '优先级' : boardGroupMode === 'due' ? '截止时间' : boardGroupMode === 'project' ? '清单' : fields.find(field => field.id === groupFieldId)?.name}</span></summary><div className="tasks-item-menu-popover tasks-tool-popover"><p className="tasks-tool-title">选择当前任务的展示方式</p><label className="tasks-filter-row">分组依据
            <select value={(mode === 'list' || selection === 'done') && !listGrouped ? 'none' : boardGroupMode === 'field' ? `field:${groupFieldId ?? ''}` : boardGroupMode} aria-label="看板分组方式" onChange={event => applyGrouping(event.target.value)}>
              {(mode === 'list' || selection === 'done') && <option value="none">不分组</option>}
              <option value="custom">自定义分组</option>
              <option value="priority">按优先级</option>
              <option value="due">按截止时间</option>
              <option value="project">按清单</option>
              {fields.map(field => <option key={field.id} value={`field:${field.id}`}>按{field.name}</option>)}
            </select>
          </label></div></details>
          <details className="tasks-tool-menu tasks-field-menu">
            <summary aria-label="字段配置" title="字段配置"><TaskIcon name="fields" /><span>字段配置</span></summary>
            <div className="tasks-item-menu-popover tasks-tool-popover tasks-field-popover">
              <p className="tasks-tool-title">字段配置</p>
              <button type="button" className="tasks-fields-toggle" onClick={event => { setFieldsOpen(true); event.currentTarget.closest('details')?.removeAttribute('open') }}><TaskIcon name="plus" />管理自定义字段</button>
              <div className="tasks-field-visibility-list" role="group" aria-label="字段显示与隐藏">
                <div className="tasks-field-visibility-row"><span>任务名称</span><button type="button" disabled aria-label="任务名称始终显示" title="任务名称始终显示"><TaskIcon name="eye" /></button></div>
                {[{ id: 'start', name: '开始时间' }, { id: 'due', name: '截止时间' }, { id: 'priority', name: '优先级' }, { id: 'project', name: '所属清单' }, { id: 'note', name: '备注' }, ...fields].map(field => {
                  const visible = !hiddenFields.includes(field.id)
                  return <div className="tasks-field-visibility-row" key={field.id} data-hidden={!visible || undefined}>
                    <span>{field.name}</span>
                    <button type="button" data-menu-keep-open role="switch" aria-checked={visible} aria-label={`显示${field.name}`} title={`${visible ? '隐藏' : '显示'}${field.name}`}
                      onClick={() => setHiddenFields(current => current.includes(field.id) ? current.filter(id => id !== field.id) : [...current, field.id])}>
                      <TaskIcon name={visible ? 'eye' : 'eyeOff'} />
                    </button>
                  </div>
                })}
              </div>
            </div>
          </details>
        </div>

      </div>

      {query && <div className="tasks-search-context">搜索结果：{query}<button type="button" aria-label="清除任务搜索条件" onClick={() => setQuery('')}>清除</button></div>}
      {(selection === 'done' ? doneVisible.length : sorted.length) === 0 && (mode === 'list' || selection === 'done') && !draft && !loading && <div className="tasks-empty">
        <span className="tasks-empty-icon"><TaskIcon name={selection === 'unplanned' ? 'unplanned' : 'task'} /></span>
        {effectiveStatus === 'done'
          ? <><h2>{query.trim() ? '没有匹配的已完成任务' : '还没有已完成的任务'}</h2><p>{query.trim() ? '试试其他关键词，或清空搜索。' : '完成的任务会保留在这里，可随时恢复。'}</p></>
          : <><h2>{query.trim() ? '没有匹配的任务' : selection === 'unplanned' ? '没有待规划的任务' : selection.startsWith('project:') ? '这个清单还没有任务' : selection.startsWith('view:') ? '这个视图还没有匹配的任务' : '这里没有待办任务'}</h2><p>{query.trim() ? '试试其他关键词，或清空搜索。' : selection === 'unplanned' ? '未设置开始时间和截止时间的任务会显示在这里。' : '点击「新建任务」，记录下一件要做的事。'}</p></>}
      </div>}

      {collectionDialogOpen && <TaskCollectionDialog
        title={groupRenaming ? '重命名分组' : newProject !== null ? '新建清单' : '新建清单分组'}
        name={groupRenaming?.name ?? newProject ?? newGroup ?? ''}
        onNameChange={name => { if (groupRenaming) setGroupRenaming({ ...groupRenaming, name }); else if (newProject !== null) setNewProject(name); else setNewGroup(name) }}
        groups={newProject !== null ? groups : undefined} groupId={projectGroupId} onGroupChange={setProjectGroupId}
        busy={projectBusy} error={error} editing={Boolean(groupRenaming)}
        onSubmit={groupRenaming ? submitGroupRename : newProject !== null ? submitProject : submitGroup}
        onClose={closeCollectionDialog} />}

      {draft && <TaskEditorDialog draft={draft} projects={projects} groups={groups} displayGroups={customGroups} fields={fields} busy={busy || projectBusy} error={error} dialogRef={taskDialogRef} onChange={setDraft} onCreateProject={createDraftProject} onClose={() => { if (!busy && !projectBusy) setDraft(null) }} onSubmit={submitDraft} />}

      {viewDraft && <div className="tasks-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setViewDraft(null) }}>
        <div className="tasks-dialog tasks-view-dialog" role="dialog" aria-modal="true" aria-labelledby="tasks-view-dialog-title" onMouseDown={event => event.stopPropagation()}>
          <header className="tasks-dialog-header">
            <h2 id="tasks-view-dialog-title">{viewDraft.id ? '编辑视图' : '新建视图'}</h2>
            <button type="button" aria-label="关闭视图弹窗" onClick={() => setViewDraft(null)}>×</button>
          </header>
          <form className="tasks-form" onSubmit={submitViewDraft} aria-label={viewDraft.id ? '编辑视图' : '新建视图'}>
            {error && <p role="alert" className="tasks-error">{error}</p>}
            <label className="tasks-view-property">
              <span className="tasks-view-property-name">名称：</span>
              <input value={viewDraft.name} onChange={e => setViewDraft({ ...viewDraft, name: e.target.value })}
                autoFocus aria-label="视图名称" placeholder="例如：高优跟进" />
            </label>
            <fieldset className="tasks-view-filters">
              <legend>筛选条件（不选即不限）</legend>
              <label className="tasks-view-property">
                <span className="tasks-view-property-name">截止范围：</span>
                <select value={viewDraft.dueRange} onChange={e => setViewDraft({ ...viewDraft, dueRange: e.target.value as TaskDueRange })} aria-label="视图截止范围">
                  {(Object.keys(DUE_RANGE_LABELS) as TaskDueRange[]).map(id => <option key={id} value={id}>{DUE_RANGE_LABELS[id]}</option>)}
                </select>
              </label>
              <div className="tasks-view-property">
                <span className="tasks-view-property-name" id="tasks-view-priority-label">优先级：</span>
                <div className="tasks-view-checks" role="group" aria-labelledby="tasks-view-priority-label">
                  {(['high', 'medium', 'low'] as TaskPriority[]).map(priority => (
                    <label key={priority} className="tasks-view-check">
                      <input type="checkbox" checked={viewDraft.priorities.includes(priority)}
                        onChange={e => setViewDraft({ ...viewDraft, priorities: e.target.checked ? [...viewDraft.priorities, priority] : viewDraft.priorities.filter(item => item !== priority) })} />
                      {PRIORITY_LABELS[priority]}
                    </label>
                  ))}
                </div>
              </div>
              {projects.filter(project => !project.archivedAt).length > 0 && <div className="tasks-view-property">
                <span className="tasks-view-property-name" id="tasks-view-project-label">清单：</span>
                <div className="tasks-view-checks" role="group" aria-labelledby="tasks-view-project-label">
                  {projects.filter(project => !project.archivedAt).map(project => (
                    <label key={project.id} className="tasks-view-check">
                      <input type="checkbox" checked={viewDraft.projectIds.includes(project.id)}
                        onChange={e => setViewDraft({ ...viewDraft, projectIds: e.target.checked ? [...viewDraft.projectIds, project.id] : viewDraft.projectIds.filter(item => item !== project.id) })} />
                      {project.name}
                    </label>
                  ))}
                </div>
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
      {displayGroupDraft && <TaskDisplayGroupForm key={displayGroupDraft.id} initialName={displayGroupDraft.name} editing={Boolean(displayGroupDraft.id)} onSave={saveDisplayGroup} onCancel={() => setDisplayGroupDraft(null)} />}
      {selection !== 'done' && mode === 'board'
        ? <TasksBoard orderScope={selection} tasks={sorted} projects={projects} fields={displayFields} groupingFields={fields} customGroups={customGroups} renderGroupActions={renderDisplayGroupActions} onNewGroup={startDisplayGroup} hideNote={hiddenFields.includes('note')} groupMode={boardGroupMode} groupFieldId={groupFieldId}
            onEdit={task => setDraft(draftFromTask(task))}
            onComplete={complete}
            onReopen={reopen}
            onCreate={(patch, groupId) => { setError(''); setDraft({ ...createDraft(patch), displayGroupId: boardGroupMode === 'custom' ? groupId : '' }) }}
            onMove={async (id, patch, targetId, after, groupId) => {
              if (Object.keys(patch).length) {
                const saved = await window.electronAPI.tasks.update(id, patch)
                const update = (current: TaskRecord[]) => current.map(task => task.id === id ? saved : task)
                setTasks(update); setDoneTasks(update)
              }
              preferences.update(selection, current => ({ ...current, sortMode: 'manual', taskOrder: moveTaskInOrder(current.sortMode === 'manual' ? current.taskOrder : sorted.map(task => task.id), sorted.map(task => task.id), id, targetId, after), customGroups: boardGroupMode === 'custom' && groupId !== undefined ? assignTaskToGroup(current.customGroups, id, groupId) : current.customGroups }))
              setNotice('任务位置已保存，当前视图使用手动排序。')
              reloadRef.current()
            }} />
        : listGrouped
        ? <div className="tasks-grouped-list">{groupTasks(selection === 'done' ? doneVisible : sorted, projects, fields, boardGroupMode, groupFieldId, now, customGroups).map(column => <div className="tasks-content-group-shell" key={column.key || 'none'} data-drop-target={listDropGroup === column.key || undefined}
            onDragOver={event => { if (boardGroupMode === 'custom' && event.dataTransfer.types.includes('application/x-chouyu-list-task')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setListDropGroup(column.key) } }}
            onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setListDropGroup(null) }}
            onDrop={event => {
              setListDropGroup(null)
              if (boardGroupMode !== 'custom') return
              const id = event.dataTransfer.getData('application/x-chouyu-list-task')
              if (!(selection === 'done' ? doneVisible : sorted).some(task => task.id === id)) return
              event.preventDefault()
              preferences.update(selection, current => ({ ...current, customGroups: assignTaskToGroup(current.customGroups, id, column.key) }))
              setNotice(`任务已移到「${column.label}」。`)
            }}>
          <details className="tasks-content-group" data-group-key={column.key} open>
            <summary><TaskIcon name="chevron" /><span>{column.label}</span><span className="tasks-count">{column.tasks.length}</span></summary>
            <ul role="list" className={`tasks-list${selection === 'done' ? ' tasks-list-done' : ''}`} aria-label={column.label}>{column.tasks.map(renderTask)}</ul>
            {boardGroupMode === 'custom' && selection !== 'done' && <button type="button" className="tasks-group-create-task" onClick={() => setDraft({ ...createDraft(), displayGroupId: column.key })}><TaskIcon name="plus" />在{column.label}中新建任务</button>}
          </details>{renderDisplayGroupActions(column.key)}</div>)}
          {boardGroupMode === 'custom' && <button type="button" className="tasks-display-group-add" onClick={startDisplayGroup}><TaskIcon name="plus" />新建分组</button>}
          </div>
        : <ul role="list" className={`tasks-list${selection === 'done' ? ' tasks-list-done' : ''}`} aria-label={selection === 'done' ? '已完成任务' : '任务列表'}>
        {(selection === 'done' ? doneVisible : sorted).map(renderTask)}
      </ul>}
      {effectiveStatus !== 'open' && doneTasks.length < matchedDone && <button className="tasks-load-more" type="button" disabled={loading} onClick={() => setDoneLimit(limit => limit + 50)}>加载更多（已加载 {doneTasks.length} / {matchedDone}）</button>}
    </section>
  </div>
}
