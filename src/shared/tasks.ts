export type TaskPriority = 'high' | 'medium' | 'low'
export type TaskStatus = 'open' | 'done'
export type TaskRecurrence = 'none' | 'daily' | 'weekly' | 'monthly'

export interface TaskProject {
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
  dueAt: number | null
  remindAt: number | null
  remindFiredAt: number | null
  recurrence: TaskRecurrence
  recurrenceAnchorAt: number | null
  createdAt: number
  updatedAt: number
  completedAt: number | null
}

export interface TaskCreateInput {
  title: string
  note?: string
  projectId?: string | null
  priority?: TaskPriority
  dueAt?: number | null
  remindAt?: number | null
  recurrence?: TaskRecurrence
}

export interface TaskUpdateInput {
  title?: string
  note?: string | null
  projectId?: string | null
  priority?: TaskPriority
  dueAt?: number | null
  remindAt?: number | null
  recurrence?: TaskRecurrence
}

export interface TaskListResult {
  open: TaskRecord[]
  done: TaskRecord[]
  totalDone: number
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

export interface TasksAPI {
  list(): Promise<TaskListResult>
  create(input: TaskCreateInput): Promise<TaskRecord>
  update(id: string, patch: TaskUpdateInput): Promise<TaskRecord>
  complete(id: string): Promise<TaskRecord>
  reopen(id: string): Promise<TaskRecord>
  remove(id: string): Promise<void>
  projects(): Promise<TaskProject[]>
  createProject(name: string): Promise<TaskProject>
  renameProject(id: string, name: string): Promise<TaskProject>
  archiveProject(id: string, archived: boolean): Promise<TaskProject>
  views(): Promise<TaskView[]>
  createView(input: TaskViewInput): Promise<TaskView>
  updateView(id: string, patch: Partial<TaskViewInput>): Promise<TaskView>
  deleteView(id: string): Promise<void>
  ready(): void
  onTasksReminder(callback: (event: TasksReminderEvent) => void): () => void
  onOpenTasksPanel(callback: () => void): () => void
  onTasksStoreRebuilt(callback: () => void): () => void
}
