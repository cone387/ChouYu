import { nextTaskOccurrence, validateReminders, type TaskRecurrence, type TaskRepeatRule, type TaskReminder } from './taskScheduling'
export type { TaskRecurrence, TaskRepeatRule, TaskReminder } from './taskScheduling'
export type TaskPriority = 'high' | 'medium' | 'low'
export type TaskStatus = 'open' | 'done'
export interface TaskChecklistItem { id: string; title: string; done: boolean; dueAt?: number | null; reminders?: TaskReminder[] }
export interface TaskSource { kind: 'chat' | 'journal' | 'continuation'; id: string; label: string; date?: string }

export function validateTaskChecklist(input: unknown): TaskChecklistItem[] {
  if (input === undefined) return []
  if (!Array.isArray(input) || input.length > 100) throw new Error('任务子项最多 100 项。')
  const ids = new Set<string>()
  return input.map(item => {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id || item.id.length > 200 || ids.has(item.id) || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 200 || typeof item.done !== 'boolean') throw new Error('任务子项无效。')
    ids.add(item.id)
    const result: TaskChecklistItem = { id: item.id, title: item.title.trim(), done: item.done }
    if (item.dueAt !== undefined && item.dueAt !== null) {
      if (typeof item.dueAt !== 'number' || !Number.isFinite(item.dueAt)) throw new Error('任务子项无效。')
      result.dueAt = Math.round(item.dueAt)
    }
    const reminders = item.reminders === undefined ? [] : validateReminders(item.reminders)
    if (reminders.length > 0 && result.dueAt === undefined) throw new Error('子项提醒需要先设置截止时间。')
    if (reminders.length) result.reminders = reminders
    return result
  })
}

export function validateTaskSource(input: unknown): TaskSource | null {
  if (input == null) return null
  const value = input as TaskSource
  if (!['chat', 'journal', 'continuation'].includes(value.kind) || typeof value.id !== 'string' || !value.id || value.id.length > 200 || typeof value.label !== 'string' || value.label.length > 200 || (value.date !== undefined && (typeof value.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.date)))) throw new Error('任务来源无效。')
  return { kind: value.kind, id: value.id, label: value.label, ...(value.date ? { date: value.date } : {}) }
}

export interface TaskGroup {
  isDefault?: boolean
  id: string
  name: string
}

export interface TaskProject {
  isDefault?: boolean
  groupId?: string | null
  id: string
  name: string
  archivedAt?: number
  createdAt: number
}

export interface TaskRecord {
  checklist?: TaskChecklistItem[]
  source?: TaskSource | null
  id: string
  title: string
  note: string
  projectId: string | null
  priority: TaskPriority
  status: TaskStatus
  startAt?: number | null
  dueAt: number | null
  remindAt: number | null
  remindFiredAt: number | null
  recurrence: TaskRecurrence
  repeatRule?: TaskRepeatRule | null
  recurrenceIndex?: number
  reminders?: TaskReminder[]
  recurrenceAnchorAt: number | null
  /** 字段 id → 选项 id */
  customFields: Record<string, string>
  createdAt: number
  updatedAt: number
  completedAt: number | null
}

export interface TaskCreateInput {
  checklist?: TaskChecklistItem[]
  source?: TaskSource | null
  title: string
  note?: string
  projectId?: string | null
  priority?: TaskPriority
  startAt?: number | null
  dueAt?: number | null
  remindAt?: number | null
  recurrence?: TaskRecurrence
  repeatRule?: TaskRepeatRule | null
  reminderTimes?: number[]
  customFields?: Record<string, string | null>
}

export interface TaskUpdateInput {
  checklist?: TaskChecklistItem[]
  source?: TaskSource | null
  title?: string
  note?: string | null
  projectId?: string | null
  priority?: TaskPriority
  startAt?: number | null
  dueAt?: number | null
  remindAt?: number | null
  recurrence?: TaskRecurrence
  repeatRule?: TaskRepeatRule | null
  reminderTimes?: number[]
  /** 与存量合并:值 null 表示清除该字段 */
  customFields?: Record<string, string | null>
}

export interface TaskListOptions {
  doneLimit?: number
  doneQuery?: string
  donePriorities?: TaskPriority[]
  doneProjectIds?: string[]
  doneDueRange?: TaskDueRange
  doneSelection?: string
  doneGrouping?: TaskGroupingQuery
}

export interface TaskGroupingQuery {
  mode: 'priority' | 'due' | 'project' | 'field' | 'custom' | 'status' | 'week' | 'overdue' | 'completed'
  fieldId?: string | null
  groups?: { id: string; taskIds: string[] }[]
}

export interface TaskTrashEntry {
  id: string
  kind: 'task' | 'project' | 'group'
  name: string
  deletedAt: number
  taskCount: number
}

export interface TaskUISettings {
  preferences: string
  layoutOrder: string
  selection: string
}
export interface TaskBackupPreview {
  token: string
  createdAt: number
  taskCount: number
  projectCount: number
  trashCount: number
}

export interface TaskListResult {
  open: TaskRecord[]
  done: TaskRecord[]
  totalDone: number
  matchedDone: number
  doneViewCounts: Record<string, number>
  doneGroupCounts: Record<string, number>
  quarantinedAt: number | null
}

export type TaskDueRange = 'today' | 'week' | 'overdue' | 'none' | 'any'

export interface TaskView {
  id: string
  name: string
  /** 空数组表示全部项目 */
  projectIds: string[]
  /** 空数组表示全部优先级 */
  priorities: TaskPriority[]
  dueRange: TaskDueRange
  createdAt: number
  updatedAt: number
}

export interface TaskViewInput {
  name: string
  projectIds?: string[]
  priorities?: TaskPriority[]
  dueRange?: TaskDueRange
}

export const DUE_RANGE_LABELS: Record<TaskDueRange, string> = {
  today: '今天截止', week: '本周截止', overdue: '已过期', none: '无截止时间', any: '不限'
}

export interface TaskReminderPayload {
  id: string
  title: string
  dueAt: number | null
  priority: TaskPriority
}

export type TasksReminderEvent = { task: TaskReminderPayload } | { backlog: number }

export interface TaskFieldOption {
  id: string
  name: string
}

/** 单选自定义字段:任务通过 customFields[fieldId] = optionId 关联选项。 */
export interface TaskSelectField {
  id: string
  name: string
  options: TaskFieldOption[]
  createdAt: number
  updatedAt: number
}

export interface TaskSelectFieldInput {
  name: string
  options?: string[]
}

export interface TaskSelectFieldUpdateInput {
  name?: string
  /** 带 id 的选项支持改名；省略 id 表示新增。字符串数组兼容旧调用。 */
  options?: string[] | { id?: string; name: string }[]
}

export const TASK_PRIORITY_ORDER: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 }
export const PRIORITY_LABELS: Record<TaskPriority, string> = { high: '高', medium: '中', low: '低' }

export const REMIND_CHOICES = [
  { id: 'due', label: '截止时', offsetMs: 0 },
  { id: 'm30', label: '提前 30 分钟', offsetMs: 30 * 60_000 },
  { id: 'h1', label: '提前 1 小时', offsetMs: 60 * 60_000 },
  { id: 'd1', label: '提前 1 天', offsetMs: 24 * 60 * 60_000 },
  { id: 'none', label: '不提醒', offsetMs: null }
] as const
export type RemindChoiceId = (typeof REMIND_CHOICES)[number]['id']

export const RECURRENCE_LABELS: Record<TaskRecurrence, string> = { none: '不重复', daily: '每天', weekly: '每周', monthly: '每月', yearly: '每年', weekdays: '工作日（周一至周五）', lunarYearly: '每年农历', custom: '自定义' }

export function nextRecurrenceDueAt(dueAt: number, recurrence: TaskRecurrence, anchorAt = dueAt, notBefore?: number): number | null {
  return nextTaskOccurrence(dueAt, recurrence, null, anchorAt, Number.isFinite(notBefore) ? notBefore! : dueAt)
}

export function remindAtFromChoice(choiceId: RemindChoiceId, dueAt: number | null): number | null {
  const choice = REMIND_CHOICES.find(item => item.id === choiceId)
  if (!choice || choice.offsetMs === null || dueAt === null || !Number.isFinite(dueAt)) return null
  return dueAt - choice.offsetMs
}

function startOfDay(at: number): number {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function addDays(at: number, days: number): number {
  const date = new Date(at)
  date.setDate(date.getDate() + days)
  return date.getTime()
}

export function isOverdue(task: TaskRecord, now: number): boolean {
  return task.status === 'open' && task.dueAt !== null && task.dueAt < startOfDay(now)
}

export function isDueToday(task: TaskRecord, now: number): boolean {
  if (task.dueAt === null) return false
  const start = startOfDay(now)
  return task.dueAt >= start && task.dueAt < addDays(start, 1)
}

export function isDueThisWeek(task: TaskRecord, now: number): boolean {
  if (task.dueAt === null) return false
  const current = new Date(startOfDay(now))
  const weekday = (current.getDay() + 6) % 7 // 周一为 0
  const monday = addDays(current.getTime(), -weekday)
  return task.dueAt >= monday && task.dueAt < addDays(monday, 7)
}

export type TaskSchedulePeriod = 'today' | 'tomorrow' | 'week' | 'nextWeek'

/** Local calendar bounds, with an exclusive end (also valid across DST changes). */
export function taskScheduleBounds(period: TaskSchedulePeriod, now: number): [number, number] {
  const today = startOfDay(now)
  if (period === 'week' || period === 'nextWeek') {
    const monday = addDays(today, -((new Date(today).getDay() + 6) % 7) + (period === 'nextWeek' ? 7 : 0))
    return [monday, addDays(monday, 7)]
  }
  const start = period === 'tomorrow' ? addDays(today, 1) : today
  return [start, addDays(start, 1)]
}

/** Open tasks use their execution interval; completed tasks use their completion date. */
export function matchesTaskSchedule(task: TaskRecord, period: TaskSchedulePeriod, now: number): boolean {
  const [start, end] = taskScheduleBounds(period, now)
  if (task.status === 'done') {
    return task.completedAt != null && task.completedAt >= start && task.completedAt < end
  }
  const effectiveStart = task.startAt ?? task.dueAt
  if (effectiveStart == null) return false
  return effectiveStart < end && (task.dueAt == null || task.dueAt >= start)
}

export function compareTasks(a: TaskRecord, b: TaskRecord, now: number): number {
  const bucket = (task: TaskRecord) => isOverdue(task, now) ? 0 : isDueToday(task, now) ? 1 : 2
  const byBucket = bucket(a) - bucket(b)
  if (byBucket !== 0) return byBucket
  const byPriority = TASK_PRIORITY_ORDER[a.priority] - TASK_PRIORITY_ORDER[b.priority]
  if (byPriority !== 0) return byPriority
  if (a.dueAt !== b.dueAt) {
    if (a.dueAt === null) return 1
    if (b.dueAt === null) return -1
    return a.dueAt - b.dueAt
  }
  return b.createdAt - a.createdAt
}

export type TaskSortMode = 'manual' | 'smart' | 'due' | 'start' | 'updated' | 'priority' | 'created' | 'title' | 'completed'
export const TASK_SORT_LABELS: Record<TaskSortMode, string> = {
  completed: '按完成时间',
  manual: '手动排序', smart: '智能排序', start: '按开始时间', updated: '按更新时间', due: '按截止时间', priority: '按优先级', created: '按创建时间', title: '按标题'
}

export function sortTasks(tasks: TaskRecord[], mode: TaskSortMode, now: number): TaskRecord[] {
  const copy = [...tasks]
  switch (mode) {
    case 'completed':
      copy.sort((a, b) => (b.completedAt ?? -Infinity) - (a.completedAt ?? -Infinity) || compareTasks(a, b, now))
      break
    case 'manual':
      break
    case 'due':
      copy.sort((a, b) => {
        if (a.dueAt === b.dueAt) return compareTasks(a, b, now)
        if (a.dueAt === null) return 1
        if (b.dueAt === null) return -1
        return a.dueAt - b.dueAt
      })
      break
    case 'start':
      copy.sort((a, b) => (a.startAt ?? Infinity) - (b.startAt ?? Infinity) || compareTasks(a, b, now))
      break
    case 'updated':
      copy.sort((a, b) => b.updatedAt - a.updatedAt)
      break
    case 'priority':
      copy.sort((a, b) => TASK_PRIORITY_ORDER[a.priority] - TASK_PRIORITY_ORDER[b.priority] || compareTasks(a, b, now))
      break
    case 'created':
      copy.sort((a, b) => b.createdAt - a.createdAt)
      break
    case 'title':
      copy.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN') || compareTasks(a, b, now))
      break
    default:
      copy.sort((a, b) => compareTasks(a, b, now))
  }
  return copy
}

export function matchesTaskView(task: TaskRecord, view: Pick<TaskView, 'projectIds' | 'priorities' | 'dueRange'>, now: number): boolean {
  if (view.projectIds.length > 0 && !view.projectIds.includes(task.projectId ?? '')) return false
  if (view.priorities.length > 0 && !view.priorities.includes(task.priority)) return false
  switch (view.dueRange) {
    case 'today': return isDueToday(task, now)
    case 'week': return isDueThisWeek(task, now)
    case 'overdue': return isOverdue(task, now)
    case 'none': return task.dueAt === null
    default: return true
  }
}

export function formatTaskDue(at: number): string {
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(at)
}

export interface TasksAPI {
  onChanged(callback: () => void): () => void
  get(id: string): Promise<TaskRecord | null>
  exportBackup(settings: TaskUISettings): Promise<boolean>
  selectBackup(): Promise<TaskBackupPreview | null>
  restoreBackup(token: string, currentSettings: TaskUISettings): Promise<{ settings: TaskUISettings; safetyBackupPath: string }>
  trash(): Promise<TaskTrashEntry[]>
  restoreTrash(id: string): Promise<void>
  purgeTrash(id: string): Promise<void>
  list(options?: TaskListOptions): Promise<TaskListResult>
  create(input: TaskCreateInput): Promise<TaskRecord>
  update(id: string, patch: TaskUpdateInput): Promise<TaskRecord>
  complete(id: string): Promise<TaskRecord>
  reopen(id: string): Promise<TaskRecord>
  remove(id: string): Promise<void>
  projects(): Promise<TaskProject[]>
  groups(): Promise<TaskGroup[]>
  createGroup(name: string): Promise<TaskGroup>
  renameGroup(id: string, name: string): Promise<TaskGroup>
  deleteGroup(id: string, deleteContents?: boolean): Promise<void>
  moveProject(id: string, groupId: string | null): Promise<TaskProject>
  createProject(name: string, groupId?: string | null): Promise<TaskProject>
  renameProject(id: string, name: string): Promise<TaskProject>
  archiveProject(id: string, archived: boolean): Promise<TaskProject>
  deleteProject(id: string): Promise<void>
  views(): Promise<TaskView[]>
  createView(input: TaskViewInput): Promise<TaskView>
  updateView(id: string, patch: Partial<TaskViewInput>): Promise<TaskView>
  deleteView(id: string): Promise<void>
  fields(): Promise<TaskSelectField[]>
  createField(input: TaskSelectFieldInput): Promise<TaskSelectField>
  updateField(id: string, patch: TaskSelectFieldUpdateInput): Promise<TaskSelectField>
  deleteField(id: string): Promise<void>
  ready(): void
  onTasksReminder(callback: (event: TasksReminderEvent) => void): () => void
  onOpenTasksPanel(callback: (taskId?: string) => void): () => void
  onTasksStoreRebuilt(callback: () => void): () => void
}

export function isUnplanned(task: TaskRecord): boolean {
  return task.status === 'open' && task.startAt == null && task.dueAt == null
}
