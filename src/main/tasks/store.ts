import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { existsSync, renameSync } from 'node:fs'
import type {
  TaskGroup, TaskCreateInput, TaskListOptions, TaskSelectFieldUpdateInput, TaskDueRange, TaskFieldOption, TaskListResult, TaskPriority, TaskProject, TaskRecord, TaskSelectField, TaskSelectFieldInput, TaskUpdateInput, TaskRecurrence, TaskView, TaskViewInput
} from '../../shared/tasks'
import { nextRecurrenceDueAt } from '../../shared/tasks'

const SCHEMA_VERSION = 7
const PRIORITIES: TaskPriority[] = ['high', 'medium', 'low']
const RECURRENCES: TaskRecurrence[] = ['none', 'daily', 'weekly', 'monthly']
const DUE_RANGES: TaskDueRange[] = ['today', 'week', 'overdue', 'none', 'any']

interface TaskRow {
  id: string; title: string; note: string | null; project_id: string | null; priority: string
  start_at: number | null; status: string; due_at: number | null; remind_at: number | null; remind_fired_at: number | null
  recurrence: string; recurrence_anchor_at: number | null
  created_at: number; updated_at: number; completed_at: number | null
  recurrence_generated?: number
  custom_fields?: string
}
interface ProjectRow { is_default?: number; group_id: string | null; id: string; name: string; archived_at: number | null; created_at: number }
interface ViewRow {
  id: string; name: string; project_ids: string; priorities: string
  due_range: string; created_at: number; updated_at: number
}
interface FieldRow {
  id: string; name: string; options: string; created_at: number; updated_at: number
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
const assertCustomFieldValues = (value: unknown): Record<string, string | null> => {
  if (value === undefined || value === null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('自定义字段无效。')
  return value as Record<string, string | null>
}
const parseJsonList = (value: string): string[] => {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter(item => typeof item === 'string') : []
  } catch {
    return []
  }
}
const assertFieldName = (name: unknown): string => {
  const value = typeof name === 'string' ? name.trim() : ''
  if (!value) throw new Error('字段名称不能为空。')
  if (value.length > 50) throw new Error('字段名称过长。')
  return value
}
const assertOptionNames = (value: unknown): string[] => {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error('选项无效。')
  const names = value.map(item => item.trim()).filter(item => item.length > 0)
  if (names.length > 30) throw new Error('选项过多。')
  return [...new Set(names)]
}
const parseCustomFields = (value: string | null | undefined): Record<string, string> => {
  if (!value) return {}
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  } catch {
    return {}
  }
}
const parseFieldOptions = (value: string): TaskFieldOption[] => {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is TaskFieldOption =>
      Boolean(item) && typeof item === 'object' && typeof (item as TaskFieldOption).id === 'string' && typeof (item as TaskFieldOption).name === 'string')
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
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER,
      custom_fields TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS tasks_status_due ON tasks(status, due_at);
    CREATE INDEX IF NOT EXISTS tasks_remind ON tasks(status, remind_at, remind_fired_at);
    CREATE TABLE IF NOT EXISTS task_views (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      project_ids TEXT NOT NULL DEFAULT '[]', priorities TEXT NOT NULL DEFAULT '[]',
      due_range TEXT NOT NULL DEFAULT 'any',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_fields (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      options TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
  `)
  const columns = database.pragma('table_info(tasks)') as { name?: unknown }[]
  if (columns.length > 0 && !columns.some(column => column.name === 'custom_fields')) {
    database.exec("ALTER TABLE tasks ADD COLUMN custom_fields TEXT NOT NULL DEFAULT '{}'")
  }
  if (!columns.some(column => column.name === 'recurrence_generated')) {
    database.transaction(() => {
      database.exec("ALTER TABLE tasks ADD COLUMN recurrence_generated INTEGER NOT NULL DEFAULT 0")
      // 旧版完成实例已经生成过下一期，不靠标题或时间猜测关联。
      database.exec("UPDATE tasks SET recurrence_generated = 1 WHERE status = 'done' AND recurrence <> 'none' AND due_at IS NOT NULL")
    })()
  }
  database.exec('CREATE TABLE IF NOT EXISTS task_groups (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE)')
  const projectColumns = database.pragma('table_info(task_projects)') as { name: string }[]
  if (!projectColumns.some(column => column.name === 'group_id')) {
    database.exec('ALTER TABLE task_projects ADD COLUMN group_id TEXT REFERENCES task_groups(id)')
  }
  database.transaction(() => {
    if (!columns.some(column => column.name === 'start_at')) database.exec('ALTER TABLE tasks ADD COLUMN start_at INTEGER')
    if (!projectColumns.some(column => column.name === 'is_default')) database.exec('ALTER TABLE task_projects ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0')
    if (!database.prepare('SELECT id FROM task_projects WHERE is_default = 1').get()) {
      const existing = database.prepare('SELECT id FROM task_projects WHERE name = ?').get('收集箱') as { id: string } | undefined
      const id = existing?.id ?? randomUUID()
      if (!existing) database.prepare('INSERT INTO task_projects (id, name, created_at) VALUES (?, ?, ?)').run(id, '收集箱', Date.now())
      database.prepare('UPDATE task_projects SET is_default = 1, archived_at = NULL, group_id = NULL WHERE id = ?').run(id)
      database.prepare('UPDATE tasks SET project_id = ? WHERE project_id IS NULL').run(id)
    }
  })()
  database.transaction(() => {
    const groupColumns = database.pragma('table_info(task_groups)') as { name: string }[]
    if (!groupColumns.some(column => column.name === 'is_default')) database.exec('ALTER TABLE task_groups ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0')
    let group = database.prepare('SELECT id FROM task_groups WHERE is_default = 1').get() as { id: string } | undefined
    if (!group) {
      group = database.prepare('SELECT id FROM task_groups WHERE name = ?').get('收集箱') as { id: string } | undefined
      if (!group) {
        group = { id: randomUUID() }
        database.prepare('INSERT INTO task_groups (id, name, is_default) VALUES (?, ?, 1)').run(group.id, '收集箱')
      } else database.prepare('UPDATE task_groups SET is_default = 1 WHERE id = ?').run(group.id)
    }
    const project = database.prepare('SELECT id, name FROM task_projects WHERE is_default = 1').get() as { id: string; name: string }
    // Preserve the old default project's identity, renamed names, and every task association.
    if (project.name === '收集箱') {
      let name = '默认清单'
      let suffix = 2
      while (database.prepare('SELECT id FROM task_projects WHERE name = ? AND id <> ?').get(name, project.id)) name = `默认清单（${suffix++}）`
      database.prepare('UPDATE task_projects SET name = ? WHERE id = ?').run(name, project.id)
    }
    database.prepare('UPDATE task_projects SET group_id = ? WHERE group_id IS NULL OR is_default = 1').run(group.id)
    database.prepare('UPDATE tasks SET project_id = ? WHERE project_id IS NULL').run(project.id)
    database.pragma(`user_version = ${SCHEMA_VERSION}`)
  })()
}

const toTask = (row: TaskRow): TaskRecord => ({
  id: row.id, title: row.title, note: row.note ?? '', projectId: row.project_id,
  priority: (PRIORITIES.includes(row.priority as TaskPriority) ? row.priority : 'medium') as TaskPriority,
  status: row.status === 'done' ? 'done' : 'open',
  startAt: row.start_at, dueAt: row.due_at, remindAt: row.remind_at, remindFiredAt: row.remind_fired_at,
  recurrence: (['daily', 'weekly', 'monthly'].includes(row.recurrence) ? row.recurrence : 'none') as TaskRecord['recurrence'],
  recurrenceAnchorAt: row.recurrence_anchor_at,
  customFields: parseCustomFields(row.custom_fields),
  createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at
})
const toProject = (row: ProjectRow): TaskProject => ({
  isDefault: row.is_default === 1, id: row.id, name: row.name, groupId: row.group_id, ...(row.archived_at !== null ? { archivedAt: row.archived_at } : {}), createdAt: row.created_at
})
const toView = (row: ViewRow): TaskView => ({
  id: row.id, name: row.name,
  projectIds: parseJsonList(row.project_ids),
  priorities: parseJsonList(row.priorities).filter(item => PRIORITIES.includes(item as TaskPriority)) as TaskPriority[],
  dueRange: (DUE_RANGES.includes(row.due_range as TaskDueRange) ? row.due_range : 'any') as TaskDueRange,
  createdAt: row.created_at, updatedAt: row.updated_at
})

const toField = (row: FieldRow): TaskSelectField => ({
  id: row.id, name: row.name, options: parseFieldOptions(row.options), createdAt: row.created_at, updatedAt: row.updated_at
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

  listGroups(): TaskGroup[] {
    return (this.database.prepare('SELECT id, name, is_default FROM task_groups ORDER BY is_default DESC, rowid').all() as { id: string; name: string; is_default: number }[]).map(row => ({ id: row.id, name: row.name, ...(row.is_default ? { isDefault: true } : {}) }))
  }

  createGroup(name: string): TaskGroup {
    const clean = typeof name === 'string' ? name.trim() : ''
    if (!clean || clean.length > 50) throw new Error('分组名称须为 1–50 个字符。')
    const group = { id: randomUUID(), name: clean }
    if (this.database.prepare('SELECT id FROM task_groups WHERE name = ?').get(clean)) throw new Error('同名分组已存在。')
    this.database.prepare('INSERT INTO task_groups (id, name) VALUES (?, ?)').run(group.id, group.name)
    return group
  }

  renameGroup(id: string, name: string): TaskGroup {
    this.requireGroup(id)
    const clean = typeof name === 'string' ? name.trim() : ''
    if (!clean || clean.length > 50) throw new Error('分组名称须为 1–50 个字符。')
    if (this.database.prepare('SELECT id FROM task_groups WHERE name = ? AND id <> ?').get(clean, id)) throw new Error('同名分组已存在。')
    this.database.prepare('UPDATE task_groups SET name = ? WHERE id = ?').run(clean, id)
    return this.listGroups().find(group => group.id === id)!
  }

  deleteGroup(id: string): void {
    this.requireGroup(id)
    if (id === this.defaultGroupId()) throw new Error('默认分组不能删除。')
    this.database.transaction(() => {
      this.database.prepare('UPDATE task_projects SET group_id = ? WHERE group_id = ?').run(this.defaultGroupId(), id)
      this.database.prepare('DELETE FROM task_groups WHERE id = ?').run(id)
    })()
  }

  private defaultGroupId(): string {
    return (this.database.prepare('SELECT id FROM task_groups WHERE is_default = 1').get() as { id: string }).id
  }

  private requireGroup(id: string | null): void {
    if (id !== null && (typeof id !== 'string' || !this.database.prepare('SELECT id FROM task_groups WHERE id = ?').get(id))) throw new Error('分组不存在。')
  }

  moveProject(id: string, groupId: string | null): TaskProject {
    if (this.requireProject(id).isDefault) throw new Error('默认清单不能移动。')
    groupId = groupId ?? this.defaultGroupId()
    this.requireGroup(groupId)
    this.database.prepare('UPDATE task_projects SET group_id = ? WHERE id = ?').run(groupId, id)
    return this.requireProject(id)
  }

  createProject(name: string, groupId: string | null = null): TaskProject {
    groupId = groupId ?? this.defaultGroupId()
    this.requireGroup(groupId)
    const clean = assertProjectName(name)
    const row: ProjectRow = { group_id: groupId, id: randomUUID(), name: clean, archived_at: null, created_at: Date.now() }
    try {
      this.database.prepare('INSERT INTO task_projects (id, name, archived_at, created_at, group_id) VALUES (?, ?, ?, ?, ?)')
        .run(row.id, row.name, row.archived_at, row.created_at, row.group_id)
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
    if (this.requireProject(id).isDefault) throw new Error('默认清单不能删除或归档。')
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
    if (projectId === undefined || projectId === null) return (this.database.prepare('SELECT id FROM task_projects WHERE is_default = 1').get() as { id: string }).id
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

  listFields(): TaskSelectField[] {
    const rows = this.database.prepare('SELECT * FROM task_fields ORDER BY created_at, rowid').all() as FieldRow[]
    return rows.map(toField)
  }

  createField(input: TaskSelectFieldInput): TaskSelectField {
    const name = assertFieldName(input?.name)
    const optionNames = assertOptionNames(input?.options)
    const now = Date.now()
    const row: FieldRow = {
      id: randomUUID(), name,
      options: JSON.stringify(optionNames.map(optionName => ({ id: randomUUID(), name: optionName }))),
      created_at: now, updated_at: now
    }
    this.database.prepare('INSERT INTO task_fields (id, name, options, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(row.id, row.name, row.options, row.created_at, row.updated_at)
    return toField(row)
  }

  updateField(id: string, patch: TaskSelectFieldUpdateInput): TaskSelectField {
    const outcome = this.database.transaction((): TaskSelectField | null => {
      const current = this.database.prepare('SELECT * FROM task_fields WHERE id = ?').get(id) as FieldRow | undefined
      if (!current) return null
      const existing = toField(current)
      const name = patch?.name === undefined ? existing.name : assertFieldName(patch.name)
      // 显式 id 保留改名关联；只有移除选项才清理任务引用。
      const options = patch?.options === undefined ? existing.options : this.mergeOptions(existing.options, patch.options)
      this.database.prepare('UPDATE task_fields SET name = ?, options = ?, updated_at = ? WHERE id = ?')
        .run(name, JSON.stringify(options), Date.now(), id)
      if (patch?.options !== undefined) this.pruneFieldValues(id, new Set(options.map(option => option.id)))
      return this.requireField(id)
    })()
    if (!outcome) throw new Error('字段不存在。')
    return outcome
  }

  private mergeOptions(existing: TaskFieldOption[], input: unknown): TaskFieldOption[] {
    if (!Array.isArray(input)) throw new Error('选项无效。')
    if (input.every(item => typeof item === 'string')) {
      return assertOptionNames(input).map(name => ({ id: existing.find(option => option.name === name)?.id ?? randomUUID(), name }))
    }
    if (input.length > 30) throw new Error('选项过多。')
    const ids = new Set<string>()
    const names = new Set<string>()
    return input.map(item => {
      if (!item || typeof item !== 'object' || typeof item.name !== 'string') throw new Error('选项无效。')
      const name = item.name.trim()
      if (!name || names.has(name)) throw new Error('选项名称不能为空或重复。')
      if (item.id !== undefined && (typeof item.id !== 'string' || !existing.some(option => option.id === item.id))) throw new Error('选项不存在。')
      const id = item.id ?? randomUUID()
      if (ids.has(id)) throw new Error('选项重复。')
      ids.add(id)
      names.add(name)
      return { id, name }
    })
  }

  deleteField(id: string): void {
    this.database.transaction(() => {
      this.database.prepare('DELETE FROM task_fields WHERE id = ?').run(id)
      this.pruneFieldValues(id, new Set())
    })()
  }

  /** 移除任务 custom_fields 中指向 fieldId 的值(keep 为空即全部移除)。 */
  private pruneFieldValues(fieldId: string, keepOptionIds: Set<string>): void {
    const rows = this.database.prepare("SELECT id, custom_fields FROM tasks WHERE custom_fields <> '{}'").all() as { id: string; custom_fields: string }[]
    for (const row of rows) {
      const values = parseCustomFields(row.custom_fields)
      const value = values[fieldId]
      if (value === undefined || keepOptionIds.has(value)) continue
      delete values[fieldId]
      this.database.prepare('UPDATE tasks SET custom_fields = ? WHERE id = ?').run(JSON.stringify(values), row.id)
    }
  }

  private requireField(id: string): TaskSelectField {
    const row = this.database.prepare('SELECT * FROM task_fields WHERE id = ?').get(id) as FieldRow
    if (!row) throw new Error('字段不存在。')
    return toField(row)
  }

  createTask(input: TaskCreateInput): TaskRecord {
    const title = assertTitle(input?.title)
    const note = assertText(input?.note, 2_000)
    const projectId = this.requireActiveProjectId(input?.projectId)
    const priority = assertPriority(input?.priority)
    const startAt = assertTimestamp(input?.startAt, '开始时间')
    const dueAt = assertTimestamp(input?.dueAt, '截止时间')
    if (startAt !== null && dueAt !== null && startAt > dueAt) throw new Error('开始时间不能晚于截止时间。')
    const remindAt = assertTimestamp(input?.remindAt, '提醒时间')
    const recurrence = assertRecurrence(input?.recurrence)
    const customFields = this.cleanCustomFieldValues(assertCustomFieldValues(input?.customFields))
    const now = Date.now()
    const info = this.database.prepare(`INSERT INTO tasks
      (id, title, note, project_id, priority, status, start_at, due_at, remind_at, remind_fired_at, recurrence, recurrence_anchor_at, created_at, updated_at, completed_at, custom_fields)
      VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?)`)
      .run(randomUUID(), title, note, projectId, priority, startAt, dueAt, remindAt, recurrence, recurrence === 'none' ? null : dueAt, now, now, JSON.stringify(customFields))
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
    const projectId = patch?.projectId === undefined || patch.projectId === current.project_id ? current.project_id : this.requireActiveProjectId(patch.projectId)
    const priority = patch?.priority === undefined ? current.priority : assertPriority(patch.priority)
    const startAt = patch?.startAt === undefined ? current.start_at : assertTimestamp(patch.startAt, '开始时间')
    const dueAt = patch?.dueAt === undefined ? current.due_at : assertTimestamp(patch.dueAt, '截止时间')
    if (startAt !== null && dueAt !== null && startAt > dueAt) throw new Error('开始时间不能晚于截止时间。')
    const remindAt = patch?.remindAt === undefined ? current.remind_at : assertTimestamp(patch.remindAt, '提醒时间')
    const recurrence = patch?.recurrence === undefined ? assertRecurrence(current.recurrence) : assertRecurrence(patch.recurrence)
    const resetFired = patch?.remindAt !== undefined && remindAt !== current.remind_at
    const customFields = patch?.customFields === undefined
      ? parseCustomFields(current.custom_fields)
      : this.cleanCustomFieldValues({ ...parseCustomFields(current.custom_fields), ...assertCustomFieldValues(patch.customFields) })
    this.database.prepare(`UPDATE tasks SET title = ?, note = ?, project_id = ?, priority = ?, start_at = ?, due_at = ?, remind_at = ?, remind_fired_at = ?, recurrence = ?, recurrence_anchor_at = ?, updated_at = ?, custom_fields = ? WHERE id = ?`)
      .run(title, note, projectId, priority, startAt, dueAt, remindAt, resetFired ? null : current.remind_fired_at, recurrence, recurrence === 'none' ? null : (current.recurrence_anchor_at ?? dueAt), Date.now(), JSON.stringify(customFields), id)
    return this.requireTask(id)
  }

  /** 过滤空值与字段/选项不存在的引用,顺带清理失效数据。 */
  private cleanCustomFieldValues(values: Record<string, string | null>): Record<string, string> {
    const fields = this.database.prepare('SELECT id, options FROM task_fields').all() as FieldRow[]
    const optionsByField = new Map(fields.map(field => [field.id, new Set(parseFieldOptions(field.options).map(option => option.id))]))
    const result: Record<string, string> = {}
    for (const [fieldId, optionId] of Object.entries(values)) {
      if (typeof optionId !== 'string' || optionId === '') continue
      const options = optionsByField.get(fieldId)
      if (!options || !options.has(optionId)) continue
      result[fieldId] = optionId
    }
    return result
  }

  completeTask(id: string): TaskRecord {
    const outcome = this.database.transaction((): TaskRecord | null => {
      const current = this.database.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as TaskRow | undefined
      if (!current || current.status !== 'open') return null
      const now = Date.now()
      this.database.prepare(`UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ? WHERE id = ? AND status = 'open'`).run(now, now, id)
      const recurrence = assertRecurrence(current.recurrence)
      if (recurrence !== 'none' && current.due_at !== null && !current.recurrence_generated) {
        // 迟到完成时跳过已错过的周期,避免下一期一出生就已过期
        const nextDueAt = nextRecurrenceDueAt(current.due_at, recurrence, current.recurrence_anchor_at ?? current.due_at, now)
        if (nextDueAt !== null) {
          this.database.prepare('UPDATE tasks SET recurrence_generated = 1 WHERE id = ?').run(id)
          const reminderOffset = current.remind_at !== null ? current.due_at - current.remind_at : null
          this.database.prepare(`INSERT INTO tasks
            (id, title, note, project_id, priority, status, start_at, due_at, remind_at, remind_fired_at, recurrence, recurrence_anchor_at, created_at, updated_at, completed_at, custom_fields)
            VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?)`)
            .run(randomUUID(), current.title, current.note, current.project_id, current.priority, current.start_at === null ? null : nextDueAt - (current.due_at - current.start_at), nextDueAt, reminderOffset !== null ? nextDueAt - reminderOffset : null, recurrence, current.recurrence_anchor_at ?? current.due_at, now, now, current.custom_fields ?? '{}')
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

  listTasks(options: TaskListOptions = {}): TaskListResult {
    const limit = options.doneLimit ?? 50
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('加载数量无效。')
    if (options.doneQuery !== undefined && typeof options.doneQuery !== 'string') throw new Error('搜索条件无效。')
    const query = (options.doneQuery ?? '').trim().toLocaleLowerCase()
    const priorities = assertPriorityList(options.donePriorities)
    const conditions = ["status = 'done'"]
    const params: (string | number)[] = []
    if (query) {
      conditions.push("instr(lower(title || ' ' || coalesce(note, '')), ?) > 0")
      params.push(query)
    }
    if (priorities.length) {
      conditions.push(`priority IN (${priorities.map(() => '?').join(',')})`)
      params.push(...priorities)
    }
    const addProjects = (ids: string[]) => {
      if (!ids.length) return
      conditions.push(`project_id IN (${ids.map(() => '?').join(',')})`)
      params.push(...ids)
    }
    const now = Date.now()
    const today = new Date(now); today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
    const addDue = (range: TaskDueRange | 'unplanned') => {
      if (range === 'none') conditions.push('due_at IS NULL')
      else if (range === 'unplanned') conditions.push('due_at IS NULL AND start_at IS NULL')
      else if (range === 'overdue') { conditions.push('due_at < ?'); params.push(today.getTime()) }
      else if (range === 'today') { conditions.push('due_at >= ? AND due_at < ?'); params.push(today.getTime(), tomorrow.getTime()) }
      else if (range === 'week') {
        const monday = new Date(today); monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7)
        const next = new Date(monday); next.setDate(next.getDate() + 7)
        conditions.push('due_at >= ? AND due_at < ?'); params.push(monday.getTime(), next.getTime())
      }
    }
    addProjects(assertIdList(options.doneProjectIds))
    addDue(assertDueRange(options.doneDueRange))
    const selection = options.doneSelection ?? 'all'
    if (typeof selection !== 'string') throw new Error('任务视图无效。')
    if (selection.startsWith('project:')) addProjects([selection.slice(8)])
    else if (selection.startsWith('view:')) {
      const view = this.listViews().find(item => item.id === selection.slice(5))
      if (!view) conditions.push('0 = 1')
      else {
        addProjects(view.projectIds); addDue(view.dueRange)
        if (view.priorities.length) {
          conditions.push(`priority IN (${view.priorities.map(() => '?').join(',')})`)
          params.push(...view.priorities)
        }
      }
    } else if (selection === 'today') addDue('today')
    else if (selection === 'week' || selection === 'overdue' || selection === 'unplanned') addDue(selection)
    else if (selection !== 'all' && selection !== 'done') throw new Error('任务视图无效。')
    const where = conditions.join(' AND ')

    const open = (this.database.prepare(`SELECT * FROM tasks WHERE status = 'open' ORDER BY created_at, rowid`).all() as TaskRow[]).map(toTask)
    const done = (this.database.prepare(`SELECT * FROM tasks WHERE ${where} ORDER BY completed_at DESC, rowid DESC LIMIT ?`).all(...params, limit) as TaskRow[]).map(toTask)
    const totalDone = (this.database.prepare(`SELECT COUNT(*) AS count FROM tasks WHERE status = 'done'`).get() as { count: number }).count
    const matchedDone = (this.database.prepare(`SELECT COUNT(*) AS count FROM tasks WHERE ${where}`).get(...params) as { count: number }).count
    return { open, done, totalDone, matchedDone, quarantinedAt: this.quarantinedAt }
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
