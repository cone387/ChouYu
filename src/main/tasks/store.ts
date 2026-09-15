import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { existsSync, renameSync } from 'node:fs'
import type {
  TaskCreateInput, TaskDueRange, TaskListResult, TaskPriority, TaskProject, TaskRecord, TaskUpdateInput, TaskRecurrence, TaskView, TaskViewInput
} from '../../shared/tasks'
import { nextRecurrenceDueAt } from '../../shared/tasks'

const SCHEMA_VERSION = 2
const PRIORITIES: TaskPriority[] = ['high', 'medium', 'low']
const RECURRENCES: TaskRecurrence[] = ['none', 'daily', 'weekly', 'monthly']
const DUE_RANGES: TaskDueRange[] = ['today', 'week', 'overdue', 'none', 'any']

interface TaskRow {
  id: string; title: string; note: string | null; project_id: string | null; priority: string
  status: string; due_at: number | null; remind_at: number | null; remind_fired_at: number | null
  recurrence: string; recurrence_anchor_at: number | null
  created_at: number; updated_at: number; completed_at: number | null
}
interface ProjectRow { id: string; name: string; archived_at: number | null; created_at: number }
interface ViewRow {
  id: string; name: string; project_ids: string; priorities: string
  due_range: string; created_at: number; updated_at: number
}

const assertTitle = (title: unknown): string => {
  const value = typeof title === 'string' ? title.trim() : ''
  if (!value) throw new Error('任务标题不能为空。')
  if (value.length > 200) throw new Error('任务标题过长。')
  return value
}
const assertProjectName = (name: unknown): string => {
  const value = typeof name === 'string' ? name.trim() : ''
  if (!value) throw new Error('项目名称不能为空。')
  if (value.length > 50) throw new Error('项目名称过长。')
  return value
}
const assertPriority = (priority: unknown): TaskPriority => {
  if (priority === undefined) return 'medium'
  if (typeof priority === 'string' && PRIORITIES.includes(priority as TaskPriority)) return priority as TaskPriority
  throw new Error('优先级无效。')
}
const assertRecurrence = (recurrence: unknown): TaskRecurrence => {
  if (recurrence === undefined) return 'none'
  if (typeof recurrence === 'string' && RECURRENCES.includes(recurrence as TaskRecurrence)) return recurrence as TaskRecurrence
  throw new Error('重复规则无效。')
}
const assertViewName = (name: unknown): string => {
  const value = typeof name === 'string' ? name.trim() : ''
  if (!value) throw new Error('视图名称不能为空。')
  if (value.length > 50) throw new Error('视图名称过长。')
  return value
}
const assertIdList = (value: unknown): string[] => {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error('项目选择无效。')
  return value
}
const assertPriorityList = (value: unknown): TaskPriority[] => {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.some(item => !PRIORITIES.includes(item as TaskPriority))) throw new Error('优先级选择无效。')
  return value as TaskPriority[]
}
const assertDueRange = (value: unknown): TaskDueRange => {
  if (value === undefined || value === null) return 'any'
  if (typeof value === 'string' && DUE_RANGES.includes(value as TaskDueRange)) return value as TaskDueRange
  throw new Error('截止范围无效。')
}
const parseJsonList = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : []
  } catch {
    return []
  }
}
const assertTimestamp = (value: unknown, label: string): number | null => {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}无效。`)
  return Math.round(value)
}
const assertText = (value: unknown, max: number): string | null => {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') throw new Error('文本内容无效。')
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

export class TasksSchemaVersionError extends Error {}

function migrate(database: Database.Database): void {
  database.pragma('journal_mode = WAL')
  database.pragma('synchronous = NORMAL')
  database.pragma('foreign_keys = ON')
  const current = database.pragma('user_version', { simple: true }) as number
  if (current > SCHEMA_VERSION) throw new TasksSchemaVersionError(`任务数据库版本过新（${current}），请先更新应用。`)
  if (current === SCHEMA_VERSION) return
  database.exec(`
    CREATE TABLE IF NOT EXISTS task_projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, archived_at INTEGER, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, note TEXT,
      project_id TEXT REFERENCES task_projects(id),
      priority TEXT NOT NULL DEFAULT 'medium', status TEXT NOT NULL DEFAULT 'open',
      due_at INTEGER, remind_at INTEGER, remind_fired_at INTEGER,
      recurrence TEXT NOT NULL DEFAULT 'none', recurrence_anchor_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS tasks_status_due ON tasks(status, due_at);
    CREATE INDEX IF NOT EXISTS tasks_remind ON tasks(status, remind_at, remind_fired_at);
    CREATE TABLE IF NOT EXISTS task_views (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      project_ids TEXT NOT NULL DEFAULT '[]', priorities TEXT NOT NULL DEFAULT '[]',
      due_range TEXT NOT NULL DEFAULT 'any',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
  `)
  database.pragma(`user_version = ${SCHEMA_VERSION}`)
}

const toTask = (row: TaskRow): TaskRecord => ({
  id: row.id, title: row.title, note: row.note ?? '', projectId: row.project_id,
  priority: (PRIORITIES.includes(row.priority as TaskPriority) ? row.priority : 'medium') as TaskPriority,
  status: row.status === 'done' ? 'done' : 'open',
  dueAt: row.due_at, remindAt: row.remind_at, remindFiredAt: row.remind_fired_at,
  recurrence: (['daily', 'weekly', 'monthly'].includes(row.recurrence) ? row.recurrence : 'none') as TaskRecord['recurrence'],
  recurrenceAnchorAt: row.recurrence_anchor_at,
  createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at
})
const toProject = (row: ProjectRow): TaskProject => ({
  id: row.id, name: row.name, ...(row.archived_at !== null ? { archivedAt: row.archived_at } : {}), createdAt: row.created_at
})
const toView = (row: ViewRow): TaskView => ({
  id: row.id, name: row.name,
  projectIds: parseJsonList(row.project_ids),
  priorities: parseJsonList(row.priorities).filter(item => PRIORITIES.includes(item as TaskPriority)) as TaskPriority[],
  dueRange: (DUE_RANGES.includes(row.due_range as TaskDueRange) ? row.due_range : 'any') as TaskDueRange,
  createdAt: row.created_at, updatedAt: row.updated_at
})

/** 仅确认的库损坏才允许隔离重建,被锁/磁盘满/权限等其他错误必须原样抛出。 */
const isCorruptionError = (error: unknown): boolean => {
  const code = (error as { code?: unknown } | null | undefined)?.code
  return code === 'SQLITE_NOTADB' || code === 'SQLITE_CORRUPT'
}

export class TasksStore {
  readonly quarantinedAt: number | null = null
  private constructor(private readonly database: Database.Database, quarantinedAt: number | null) {
    this.quarantinedAt = quarantinedAt
  }

  static open(filePath: string): TasksStore {
    let database: Database.Database | undefined
    try {
      database = new Database(filePath)
      migrate(database)
      return new TasksStore(database, null)
    } catch (error) {
      try { database?.close() } catch { /* 尽力关闭 */ }
      // 版本过新与非损坏错误原样抛出,只有确认损坏才隔离重建
      if (error instanceof TasksSchemaVersionError || !isCorruptionError(error)) throw error
      const quarantinedAt = Date.now()
      const quarantine = `${filePath}.corrupt-${quarantinedAt}`
      if (existsSync(filePath)) {
        try { renameSync(filePath, quarantine) } catch { /* 隔离失败则直接覆盖重建 */ }
      }
      for (const suffix of ['-wal', '-shm']) {
        const side = `${filePath}${suffix}`
        if (existsSync(side)) {
          try { renameSync(side, `${quarantine}${suffix}`) } catch { /* 尽力隔离侧文件 */ }
        }
      }
      try {
        database = new Database(filePath)
        migrate(database)
      } catch (rebuildError) {
        try { database?.close() } catch { /* 尽力关闭 */ }
        throw rebuildError
      }
      return new TasksStore(database, quarantinedAt)
    }
  }

  close(): void { this.database.close() }

  listProjects(): TaskProject[] {
    const rows = this.database.prepare('SELECT * FROM task_projects ORDER BY created_at').all() as ProjectRow[]
    return rows.map(toProject)
  }

  createProject(name: string): TaskProject {
    const clean = assertProjectName(name)
    const row: ProjectRow = { id: randomUUID(), name: clean, archived_at: null, created_at: Date.now() }
    try {
      this.database.prepare('INSERT INTO task_projects (id, name, archived_at, created_at) VALUES (?, ?, ?, ?)')
        .run(row.id, row.name, row.archived_at, row.created_at)
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new Error('同名项目已存在。')
      throw error
    }
    return toProject(row)
  }

  renameProject(id: string, name: string): TaskProject {
    const clean = assertProjectName(name)
    const result = this.database.prepare('UPDATE task_projects SET name = ? WHERE id = ?').run(clean, id)
    if (!result.changes) throw new Error('项目不存在。')
    return this.requireProject(id)
  }

  archiveProject(id: string, archived: boolean): TaskProject {
    const result = this.database.prepare('UPDATE task_projects SET archived_at = ? WHERE id = ?')
      .run(archived ? Date.now() : null, id)
    if (!result.changes) throw new Error('项目不存在。')
    return this.requireProject(id)
  }

  private requireProject(id: string): TaskProject {
    const row = this.database.prepare('SELECT * FROM task_projects WHERE id = ?').get(id) as ProjectRow | undefined
    if (!row) throw new Error('项目不存在。')
    return toProject(row)
  }

  private requireActiveProjectId(projectId: unknown): string | null {
    if (projectId === undefined || projectId === null) return null
    if (typeof projectId !== 'string') throw new Error('项目无效。')
    const row = this.database.prepare('SELECT id, archived_at FROM task_projects WHERE id = ?').get(projectId) as { id: string; archived_at: number | null } | undefined
    if (!row || row.archived_at !== null) throw new Error('项目不存在或已归档。')
    return row.id
  }

  listViews(): TaskView[] {
    const rows = this.database.prepare('SELECT * FROM task_views ORDER BY created_at, rowid').all() as ViewRow[]
    return rows.map(toView)
  }

  createView(input: TaskViewInput): TaskView {
    const name = assertViewName(input?.name)
    const projectIds = assertIdList(input?.projectIds)
    const priorities = assertPriorityList(input?.priorities)
    const dueRange = assertDueRange(input?.dueRange)
    const now = Date.now()
    const row: ViewRow = {
      id: randomUUID(), name, project_ids: JSON.stringify(projectIds), priorities: JSON.stringify(priorities),
      due_range: dueRange, created_at: now, updated_at: now
    }
    this.database.prepare(`INSERT INTO task_views (id, name, project_ids, priorities, due_range, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(row.id, row.name, row.project_ids, row.priorities, row.due_range, row.created_at, row.updated_at)
    return toView(row)
  }

  updateView(id: string, patch: Partial<TaskViewInput>): TaskView {
    const current = this.database.prepare('SELECT * FROM task_views WHERE id = ?').get(id) as ViewRow | undefined
    if (!current) throw new Error('视图不存在。')
    const existing = toView(current)
    const name = patch?.name === undefined ? existing.name : assertViewName(patch.name)
    const projectIds = patch?.projectIds === undefined ? existing.projectIds : assertIdList(patch.projectIds)
    const priorities = patch?.priorities === undefined ? existing.priorities : assertPriorityList(patch.priorities)
    const dueRange = patch?.dueRange === undefined ? existing.dueRange : assertDueRange(patch.dueRange)
    this.database.prepare('UPDATE task_views SET name = ?, project_ids = ?, priorities = ?, due_range = ?, updated_at = ? WHERE id = ?')
      .run(name, JSON.stringify(projectIds), JSON.stringify(priorities), dueRange, Date.now(), id)
    return this.requireView(id)
  }

  deleteView(id: string): void {
    this.database.prepare('DELETE FROM task_views WHERE id = ?').run(id)
  }

  private requireView(id: string): TaskView {
    const row = this.database.prepare('SELECT * FROM task_views WHERE id = ?').get(id) as ViewRow
    if (!row) throw new Error('视图不存在。')
    return toView(row)
  }

  createTask(input: TaskCreateInput): TaskRecord {
    const title = assertTitle(input?.title)
    const note = assertText(input?.note, 2_000)
    const projectId = input?.projectId === undefined ? null : this.requireActiveProjectId(input.projectId)
    const priority = assertPriority(input?.priority)
    const dueAt = assertTimestamp(input?.dueAt, '截止时间')
    const remindAt = assertTimestamp(input?.remindAt, '提醒时间')
    const recurrence = assertRecurrence(input?.recurrence)
    const now = Date.now()
    const info = this.database.prepare(`INSERT INTO tasks
      (id, title, note, project_id, priority, status, due_at, remind_at, remind_fired_at, recurrence, recurrence_anchor_at, created_at, updated_at, completed_at)
      VALUES (?, ?, ?, ?, ?, 'open', ?, ?, NULL, ?, ?, ?, ?, NULL)`)
      .run(randomUUID(), title, note, projectId, priority, dueAt, remindAt, recurrence, recurrence === 'none' ? null : dueAt, now, now)
    return this.requireTaskByRowid(Number(info.lastInsertRowid))
  }

  private requireTaskByRowid(rowid: number): TaskRecord {
    const row = this.database.prepare('SELECT * FROM tasks WHERE rowid = ?').get(rowid) as TaskRow
    return toTask(row)
  }

  updateTask(id: string, patch: TaskUpdateInput): TaskRecord {
    const current = this.database.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined
    if (!current) throw new Error('任务不存在。')
    const title = patch?.title === undefined ? current.title : assertTitle(patch.title)
    const note = patch?.note === undefined ? current.note : assertText(patch.note, 2_000)
    const projectId = patch?.projectId === undefined ? current.project_id : this.requireActiveProjectId(patch.projectId)
    const priority = patch?.priority === undefined ? current.priority : assertPriority(patch.priority)
    const dueAt = patch?.dueAt === undefined ? current.due_at : assertTimestamp(patch.dueAt, '截止时间')
    const remindAt = patch?.remindAt === undefined ? current.remind_at : assertTimestamp(patch.remindAt, '提醒时间')
    const recurrence = patch?.recurrence === undefined ? assertRecurrence(current.recurrence) : assertRecurrence(patch.recurrence)
    const resetFired = patch?.remindAt !== undefined && remindAt !== current.remind_at
    this.database.prepare(`UPDATE tasks SET title = ?, note = ?, project_id = ?, priority = ?, due_at = ?, remind_at = ?, remind_fired_at = ?, recurrence = ?, recurrence_anchor_at = ?, updated_at = ? WHERE id = ?`)
      .run(title, note, projectId, priority, dueAt, remindAt, resetFired ? null : current.remind_fired_at, recurrence, recurrence === 'none' ? null : (current.recurrence_anchor_at ?? dueAt), Date.now(), id)
    return this.requireTask(id)
  }

  completeTask(id: string): TaskRecord {
    const outcome = this.database.transaction((): TaskRecord | null => {
      const current = this.database.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined
      if (!current || current.status !== 'open') return null
      const now = Date.now()
      this.database.prepare(`UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ? AND status = 'open'`).run(now, now, id)
      const recurrence = assertRecurrence(current.recurrence)
      if (recurrence !== 'none' && current.due_at !== null) {
        // 迟到完成时跳过已错过的周期,避免下一期一出生就已过期
        const nextDueAt = nextRecurrenceDueAt(current.due_at, recurrence, current.recurrence_anchor_at ?? current.due_at, now)
        if (nextDueAt !== null) {
          const reminderOffset = current.remind_at !== null ? current.due_at - current.remind_at : null
          this.database.prepare(`INSERT INTO tasks
            (id, title, note, project_id, priority, status, due_at, remind_at, remind_fired_at, recurrence, recurrence_anchor_at, created_at, updated_at, completed_at)
            VALUES (?, ?, ?, ?, ?, 'open', ?, ?, NULL, ?, ?, ?, ?, NULL)`)
            .run(randomUUID(), current.title, current.note, current.project_id, current.priority, nextDueAt, reminderOffset !== null ? nextDueAt - reminderOffset : null, recurrence, current.recurrence_anchor_at ?? current.due_at, now, now)
        }
      }
      return this.requireTask(id)
    })()
    if (!outcome) throw new Error('任务不存在或已完成。')
    return outcome
  }

  reopenTask(id: string): TaskRecord {
    const now = Date.now()
    const result = this.database.prepare("UPDATE tasks SET status = 'open', completed_at = NULL, updated_at = ? WHERE id = ? AND status = 'done'").run(now, id)
    if (!result.changes) throw new Error('任务不存在或尚未完成')
    return this.requireTask(id)
  }

  deleteTask(id: string): void {
    this.database.prepare('DELETE FROM tasks WHERE id = ?').run(id)
  }

  private requireTask(id: string): TaskRecord {
    const row = this.database.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow
    if (!row) throw new Error('任务不存在。')
    return toTask(row)
  }

  listTasks(): TaskListResult {
    const open = (this.database.prepare(`SELECT * FROM tasks WHERE status = 'open' ORDER BY created_at, rowid`).all() as TaskRow[]).map(toTask)
    const done = (this.database.prepare(`SELECT * FROM tasks WHERE status = 'done' ORDER BY completed_at DESC, rowid DESC LIMIT 50`).all() as TaskRow[]).map(toTask)
    const totalDone = (this.database.prepare(`SELECT COUNT(*) AS count FROM tasks WHERE status = 'done'`).get() as { count: number }).count
    return { open, done, totalDone, quarantinedAt: this.quarantinedAt }
  }

  /** 原子领取到期提醒:先写 remind_fired_at 再由调用方发通知,保证只发一次。 */
  claimDueReminders(now: number): TaskRecord[] {
    const rows = this.database.prepare(`
      UPDATE tasks SET remind_fired_at = ?
      WHERE status = 'open' AND remind_at IS NOT NULL AND remind_at <= ? AND remind_fired_at IS NULL
      RETURNING *`).all(now, now) as TaskRow[]
    return rows.map(toTask)
  }
}

export function openTasksStore(filePath: string): TasksStore {
  return TasksStore.open(filePath)
}
