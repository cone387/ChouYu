export type TaskPriority = 'high' | 'medium' | 'low'
export type TaskStatus = 'open' | 'done'
export type TaskRecurrence = 'none' | 'daily' | 'weekly' | 'monthly'

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
  recurrenceAnchorAt: number | null
  /** 字段 id → 选项 id */
  customFields: Record<string, string>
  createdAt: number
  updatedAt: number
  completedAt: number | null
}

export interface TaskCreateInput {
  title: string
  note?: string
  projectId?: string | null
  priority?: TaskPriority
  startAt?: number | null
  dueAt?: number | null
  remindAt?: number | null
  recurrence?: TaskRecurrence
  customFields?: Record<string, string | null>
}

export interface TaskUpdateInput {
  title?: string
  note?: string | null
  projectId?: string | null
  priority?: TaskPriority
  startAt?: number | null
  dueAt?: number | null
  remindAt?: number | null
  recurrence?: TaskRecurrence
  /** 与存量合并:值 null 表示清除该字段 */
  customFields?: Record<string, string | null>
}

export interface TaskListOptions {
  doneLimit?: number
  doneQuery?: string
  donePriorities?: TaskPriority[]
}

export interface TaskListResult {
  open: TaskRecord[]
  done: TaskRecord[]
  totalDone: number
  matchedDone: number
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
  today: '今天和过期', week: '本周', overdue: '过期', none: '无截止', any: '不限'
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

export const RECURRENCE_LABELS: Record<TaskRecurrence, string> = { none: '不重复', daily: '每天', weekly: '每周', monthly: '每月' }

export function nextRecurrenceDueAt(dueAt: number, recurrence: TaskRecurrence, anchorAt = dueAt, notBefore?: number): number | null {
  if (!Number.isFinite(dueAt) || recurrence === 'none') return null
  const anchorDay = new Date(anchorAt).getDate()
  const floor = typeof notBefore === 'number' && Number.isFinite(notBefore) ? notBefore : -Infinity
  let date = new Date(dueAt)
  do {
    date = new Date(date)
    if (recurrence === 'daily') date.setDate(date.getDate() + 1)
    if (recurrence === 'weekly') date.setDate(date.getDate() + 7)
    if (recurrence === 'monthly') {
      date.setDate(1)
      date.setMonth(date.getMonth() + 1)
      const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
      date.setDate(Math.min(anchorDay, lastDay))
    }
  } while (date.getTime() <= floor)
  return date.getTime()
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

export type TaskSortMode = 'smart' | 'due' | 'priority' | 'created' | 'title'
export const TASK_SORT_LABELS: Record<TaskSortMode, string> = {
  smart: '智能排序', due: '按截止时间', priority: '按优先级', created: '按创建时间', title: '按标题'
}

export function sortTasks(tasks: TaskRecord[], mode: TaskSortMode, now: number): TaskRecord[] {
  const copy = [...tasks]
  switch (mode) {
    case 'due':
      copy.sort((a, b) => {
        if (a.dueAt === b.dueAt) return compareTasks(a, b, now)
        if (a.dueAt === null) return 1
        if (b.dueAt === null) return -1
        return a.dueAt - b.dueAt
      })
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
    case 'today': return isDueToday(task, now) || isOverdue(task, now)
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
  deleteGroup(id: string): Promise<void>
  moveProject(id: string, groupId: string | null): Promise<TaskProject>
  createProject(name: string, groupId?: string | null): Promise<TaskProject>
  renameProject(id: string, name: string): Promise<TaskProject>
  archiveProject(id: string, archived: boolean): Promise<TaskProject>
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
  onOpenTasksPanel(callback: () => void): () => void
  onTasksStoreRebuilt(callback: () => void): () => void
}

export function isUnplanned(task: TaskRecord): boolean {
  return task.status === 'open' && task.startAt == null && task.dueAt == null
}
