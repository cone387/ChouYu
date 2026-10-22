import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { TaskRecord, TaskProject, TaskView, TaskSelectField, TaskGroup, TaskPriority, TaskDueRange } from '../../../../shared/tasks'
import type { TaskViewPreferences } from './taskViewPreferences'
import { LatestTaskRequest, TaskCalendar, type TaskSelection as Selection } from './taskData'
interface TaskDataQuery extends Pick<TaskViewPreferences, 'groupMode' | 'groupFieldId' | 'customGroups'> {
  selection: Selection
  setSelection: Dispatch<SetStateAction<Selection>>
  query: string
  effectiveStatus: 'open' | 'done' | 'all'
  temporaryPriorities: TaskPriority[]
  temporaryProjects: string[]
  temporaryDue: TaskDueRange
  onError(message: string): void
}
export function useTaskData({ selection, setSelection, query, groupMode, groupFieldId, customGroups,
  effectiveStatus, temporaryPriorities, temporaryProjects, temporaryDue, onError }: TaskDataQuery, active: boolean) {
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [doneTasks, setDoneTasks] = useState<TaskRecord[]>([])
  const [matchedDone, setMatchedDone] = useState(0)
  const [doneLimit, setDoneLimit] = useState(50)
  const [loading, setLoading] = useState(false)
  const [hasLoaded, setHasLoaded] = useState(false)
  const requests = useRef(new LatestTaskRequest())
  const [projects, setProjects] = useState<TaskProject[]>([])
  const [views, setViews] = useState<TaskView[]>([])
  const [fields, setFields] = useState<TaskSelectField[]>([])
  const [quarantineNotice, setQuarantineNotice] = useState('')
  const [groups, setGroups] = useState<TaskGroup[]>([])
  const activeView = selection.startsWith('view:') ? views.find(view => view.id === selection.slice(5)) : undefined
  const filterPriorities = activeView?.priorities ?? temporaryPriorities
  const filterProjects = activeView?.projectIds ?? temporaryProjects
  const filterDue = activeView?.dueRange ?? temporaryDue
  const groupingQuery = JSON.stringify({ mode: groupMode === 'field' && !fields.some(field => field.id === groupFieldId) ? 'priority' : groupMode, fieldId: groupFieldId, groups: customGroups.map(group => ({ id: group.id, taskIds: group.taskIds })) })
  const countsKey = JSON.stringify([selection, query, filterPriorities, filterProjects, filterDue, groupingQuery])
  // Open tasks are returned in full and filtered locally. Only completed
  // tasks need another server page when the selection or filters change.
  const requestKey = effectiveStatus === 'open' ? JSON.stringify(['open', selection.startsWith('project:') ? selection : '', query, filterPriorities, filterProjects, filterDue]) : JSON.stringify([countsKey, doneLimit])
  const loadedRequestKey = useRef('')
  const activeRef = useRef(active)
  activeRef.current = active
  const [doneCountsResult, setDoneCountsResult] = useState<{ key: string; counts: Record<string, number> } | null>(null)
  const doneCounts = effectiveStatus !== 'open' && doneCountsResult?.key === countsKey ? doneCountsResult.counts : undefined
  const reload = useCallback(() => {
    loadedRequestKey.current = ''
    setLoading(true)
    void requests.current.run(() => Promise.all([window.electronAPI.tasks.list({ doneLimit, doneQuery: query, donePriorities: activeView ? [] : filterPriorities,
      doneProjectIds: activeView ? [] : filterProjects, doneDueRange: activeView ? 'any' : filterDue,
      doneSelection: selection, doneGrouping: JSON.parse(groupingQuery) }), window.electronAPI.tasks.projects(), window.electronAPI.tasks.views(), window.electronAPI.tasks.fields(), window.electronAPI.tasks.groups()]), ([list, projectList, viewList, fieldList, groupList]) => {
        loadedRequestKey.current = requestKey
        setHasLoaded(true)
        setTasks(list.open)
        setDoneTasks(list.done)
        setMatchedDone(list.matchedDone)
        setDoneCountsResult({ key: countsKey, counts: list.doneGroupCounts })
        setProjects(projectList)
        setViews(viewList)
        setFields(fieldList)
        setGroups(groupList)
        setSelection(current => ((current.startsWith('project:') && !projectList.some(project => project.id === current.slice(8))) ||
          (current.startsWith('view:') && !viewList.some(view => view.id === current.slice(5)))) ? 'today' : current)
        window.dispatchEvent(new Event('chouyu:tasks-changed'))
        setQuarantineNotice(list.quarantinedAt ? '任务数据文件曾无法读取，已重建空库，原文件已隔离保存。' : '')
      }, reason => onError(String(reason)), () => setLoading(false))
  }, [doneLimit, query, filterPriorities, filterProjects, filterDue, selection, groupingQuery, countsKey, requestKey])
  const reloadRef = useRef(reload)
  reloadRef.current = reload

  const calendarDay = useRef(new TaskCalendar(Date.now()))
  useEffect(() => {
    if (!active) return
    let timer: ReturnType<typeof setTimeout>
    const checkDay = () => {
      const { changed, delay } = calendarDay.current.check(Date.now())
      if (changed) reloadRef.current()
      clearTimeout(timer)
      timer = setTimeout(checkDay, delay)
    }
    checkDay()
    window.addEventListener('focus', checkDay)
    return () => { clearTimeout(timer); window.removeEventListener('focus', checkDay) }
  }, [active])

  const previousQuery = useRef(query)
  useEffect(() => {
    const typing = previousQuery.current !== query
    previousQuery.current = query
    if (!active || loadedRequestKey.current === requestKey) return
    if (!typing) {
      reload()
      return () => { requests.current.invalidate() }
    }
    const timer = setTimeout(reload, 100)
    return () => { clearTimeout(timer); requests.current.invalidate() }
  }, [active, reload, requestKey])
  // Keep the cached page while navigating. Changes received in the background
  // invalidate it, so returning still shows edits and reminder updates.
  useEffect(() => window.electronAPI.tasks.onChanged(() => {
    loadedRequestKey.current = ''
    if (activeRef.current) reloadRef.current()
    else requests.current.invalidate()
  }), [])
  useEffect(() => () => { requests.current.invalidate() }, [])
  useEffect(() => { setDoneLimit(50) }, [query, filterPriorities, filterProjects, filterDue, selection])
  return { tasks, setTasks, doneTasks, setDoneTasks, matchedDone, doneLimit, setDoneLimit, loading, hasLoaded, projects, setProjects,
    views, setViews, fields, groups, setGroups, quarantineNotice, activeView, filterPriorities, filterProjects,
    filterDue, doneCounts, reload, reloadRef }
}
