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
}

export interface TaskUpdateInput {
  title?: string
  note?: string | null
  projectId?: string | null
  priority?: TaskPriority
  dueAt?: number | null
  remindAt?: number | null
}

export interface TaskListResult {
  open: TaskRecord[]
  done: TaskRecord[]
  totalDone: number
  quarantinedAt: number | null
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

export interface TasksAPI {
  list(): Promise<TaskListResult>
  create(input: TaskCreateInput): Promise<TaskRecord>
  update(id: string, patch: TaskUpdateInput): Promise<TaskRecord>
  complete(id: string): Promise<TaskRecord>
  remove(id: string): Promise<void>
  projects(): Promise<TaskProject[]>
  createProject(name: string): Promise<TaskProject>
  renameProject(id: string, name: string): Promise<TaskProject>
  archiveProject(id: string, archived: boolean): Promise<TaskProject>
  onTasksReminder(callback: (event: TasksReminderEvent) => void): () => void
  onOpenTasksPanel(callback: () => void): () => void
  onTasksStoreRebuilt(callback: () => void): () => void
}
