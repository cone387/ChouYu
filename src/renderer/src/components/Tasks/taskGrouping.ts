import { PRIORITY_LABELS, taskScheduleBounds, type TaskPriority, type TaskProject, type TaskRecord, type TaskSelectField, type TaskUpdateInput } from '../../../../shared/tasks'
import type { TaskDisplayGroup } from './taskViewPreferences'

export type BoardGroupMode = 'priority' | 'due' | 'project' | 'field' | 'custom' | 'status' | 'week' | 'overdue' | 'completed'
export const GROUP_LABELS: Record<Exclude<BoardGroupMode, 'field'>, string> = {
  priority: '优先级', due: '截止时间', project: '清单', custom: '自定义分组',
  status: '完成状态', week: '本周日期', overdue: '逾期时长', completed: '完成日期'
}
export interface BoardColumn {
  key: string
  label: string
  patch: TaskUpdateInput
  archived?: boolean
  date?: number
  canCreate?: boolean
  hideEmpty?: boolean
}

const dayKey = (at: number) => {
  const date = new Date(at)
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}
const calendarDay = (at: number) => {
  const date = new Date(at)
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400_000
}
const isSpanning = (task: TaskRecord) => task.startAt != null && (task.dueAt == null || dayKey(task.startAt) !== dayKey(task.dueAt))

/** Null rejects a cross-group move; status transitions must use complete/reopen APIs. */
export function taskGroupMove(task: TaskRecord, mode: BoardGroupMode, column: BoardColumn, sameColumn: boolean): { patch: TaskUpdateInput; status?: 'open' | 'done' } | null {
  if (column.archived) return null
  if (sameColumn) return { patch: {} }
  if (mode === 'due' || mode === 'overdue' || mode === 'completed') return null
  if (mode === 'status') return { patch: {}, status: column.key === 'done' ? 'done' : 'open' }
  if (mode === 'week') {
    if (column.date == null || task.status === 'done' || isSpanning(task)) return null
    const onDate = (at: number) => {
      const original = new Date(at), target = new Date(column.date!)
      target.setHours(original.getHours(), original.getMinutes(), original.getSeconds(), original.getMilliseconds())
      return target.getTime()
    }
    const dueAt = task.dueAt != null ? onDate(task.dueAt) : column.date
    return { patch: {
      ...(task.startAt != null ? { startAt: onDate(task.startAt) } : {}),
      dueAt,
      ...(task.remindAt != null && task.dueAt != null ? { remindAt: dueAt - (task.dueAt - task.remindAt) } : {})
    } }
  }
  return { patch: column.patch }
}

export function groupTasks(tasks: TaskRecord[], projects: TaskProject[], fields: TaskSelectField[], groupMode: BoardGroupMode, groupFieldId: string | null, now = Date.now(), customGroups: TaskDisplayGroup[] = []) {
  const groupField = groupMode === 'field' ? fields.find(field => field.id === groupFieldId) ?? null : null
  const today = new Date(now); today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
  const afterTomorrow = new Date(tomorrow); afterTomorrow.setDate(afterTomorrow.getDate() + 1)
  const dueKey = (task: TaskRecord) => task.dueAt == null ? 'none'
    : task.dueAt < today.getTime() ? 'past'
    : task.dueAt < tomorrow.getTime() ? 'today'
    : task.dueAt < afterTomorrow.getTime() ? 'tomorrow' : 'later'

  const columns: BoardColumn[] = []
  if (groupMode === 'status') {
    columns.push({ key: 'open', label: '未完成', patch: {} }, { key: 'done', label: '已完成', patch: {}, canCreate: false })
  } else if (groupMode === 'week') {
    const [monday] = taskScheduleBounds('week', now)
    for (let index = 0; index < 7; index++) {
      const date = new Date(monday); date.setDate(date.getDate() + index)
      columns.push({ key: dayKey(date.getTime()), label: `周${'一二三四五六日'[index]} ${date.getMonth() + 1}/${date.getDate()}${dayKey(now) === dayKey(date.getTime()) ? ' · 今天' : ''}`, patch: { dueAt: date.getTime() }, date: date.getTime() })
    }
    columns.push({ key: 'spanning', label: '跨天任务', patch: {}, canCreate: false, hideEmpty: true }, { key: 'other', label: '本周以外／未安排', patch: {}, canCreate: false, hideEmpty: true })
  } else if (groupMode === 'overdue') {
    for (const [key, label] of [['long', '逾期 8 天及以上'], ['medium', '逾期 4–7 天'], ['short', '逾期 1–3 天'], ['other', '未逾期']]) columns.push({ key, label, patch: {}, canCreate: false, hideEmpty: true })
  } else if (groupMode === 'completed') {
    for (const [key, label] of [['today', '今天完成'], ['yesterday', '昨天完成'], ['recent', '近 7 天完成'], ['earlier', '更早完成'], ['other', '未完成／无完成日期']]) columns.push({ key, label, patch: {}, canCreate: false, hideEmpty: true })
  } else if (groupMode === 'priority') {
    for (const priority of ['high', 'medium', 'low'] as TaskPriority[]) {
      columns.push({ key: priority, label: `${PRIORITY_LABELS[priority]}优先级`, patch: { priority } })
    }
  } else if (groupMode === 'custom') {
    for (const group of customGroups) columns.push({ key: group.id, label: group.name, patch: {} })
    columns.push({ key: '', label: '未分组', patch: {} })
  } else if (groupMode === 'due') {
    for (const [key, label] of [['past', '早于今天'], ['today', '今天'], ['tomorrow', '明天'], ['later', '以后'], ['none', '无截止时间']]) {
      columns.push({ key, label, patch: {}, canCreate: false })
    }
  } else if (groupMode === 'project') {
    for (const project of projects.filter(project => !project.archivedAt || tasks.some(task => task.projectId === project.id))) {
      columns.push({ key: project.id, label: `${project.name}${project.archivedAt ? '（已归档）' : ''}`, patch: { projectId: project.id }, archived: Boolean(project.archivedAt), hideEmpty: true })
    }
    if (!projects.some(project => project.isDefault) || tasks.some(task => task.projectId == null)) columns.push({ key: '', label: '无清单', patch: { projectId: null }, hideEmpty: true })
  } else if (groupField) {
    for (const option of groupField.options) columns.push({ key: option.id, label: option.name, patch: { customFields: { [groupField.id]: option.id } } })
    columns.push({ key: '', label: '未设置', patch: { customFields: { [groupField.id]: null } } })
  }
  const columnOf = (task: TaskRecord): string | undefined => {
    if (groupMode === 'status') return task.status
    if (groupMode === 'week') {
      if (task.status !== 'done' && isSpanning(task)) return 'spanning'
      const at = task.status === 'done' ? task.completedAt : task.startAt ?? task.dueAt
      const key = at == null ? 'other' : dayKey(at)
      return columns.some(column => column.key === key) ? key : 'other'
    }
    if (groupMode === 'overdue') {
      const days = task.dueAt == null || task.status === 'done' ? 0 : calendarDay(now) - calendarDay(task.dueAt)
      return days >= 8 ? 'long' : days >= 4 ? 'medium' : days >= 1 ? 'short' : 'other'
    }
    if (groupMode === 'completed') {
      if (task.status !== 'done' || task.completedAt == null) return 'other'
      const days = calendarDay(now) - calendarDay(task.completedAt)
      return days === 0 ? 'today' : days === 1 ? 'yesterday' : days >= 2 && days < 7 ? 'recent' : 'earlier'
    }
    if (groupMode === 'priority') return task.priority
    if (groupMode === 'custom') return customGroups.find(group => group.taskIds.includes(task.id))?.id ?? ''
    if (groupMode === 'due') return dueKey(task)
    if (groupMode === 'project') return task.projectId ?? ''
    if (groupField) return task.customFields[groupField.id] ?? ''
    return undefined
  }
  return columns.map(column => ({ ...column, tasks: tasks.filter(task => columnOf(task) === column.key) }))
    .filter(column => !column.hideEmpty || column.tasks.length > 0)
}
